import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { ChainRow, ChainVerifier, GENESIS_HASH, VerifyResult } from './audit-chain';

const BATCH = 2000;
const EXPORT_MAX_ROWS = 100_000;
const verifyKey = (orgId: string) => `astro:audit:verify:${orgId}`;

type RawRow = Omit<ChainRow, 'seq'> & { seq: number | bigint };

export interface ExportManifest {
  organizationId: string;
  exportedAt: string;
  from: string | null;
  to: string | null;
  entries: number;
  firstSeq: number | null;
  lastSeq: number | null;
  /** chain head when the export was made (also stored as an EXPORT seal) */
  head: { seq: number; hash: string };
  verification: Pick<VerifyResult, 'ok' | 'firstBreak' | 'entries'>;
  howToVerify: string;
}

/** Reads, verifies, seals, exports, redacts and purges the audit chain of one organization. */
@Injectable()
export class AuditChainService {
  private readonly logger = new Logger('AuditChain');

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  private rows(orgId: string, afterSeq: number, limit = BATCH) {
    return this.prisma.$queryRaw<RawRow[]>(Prisma.sql`
      SELECT id, seq, "organizationId", "actorId", action, "entityType", "entityId", ip, "userAgent",
             "impersonatedById", to_char("createdAt", 'YYYY-MM-DD"T"HH24:MI:SS.MS') AS "createdAt",
             "before"::text AS "before", "after"::text AS "after", "bodyDigest", "prevHash", hash,
             ("redactedAt" IS NOT NULL) AS redacted
        FROM "AuditLogEntry"
       WHERE "organizationId" = ${orgId} AND seq > ${afterSeq}
       ORDER BY seq ASC
       LIMIT ${limit}`);
  }

  async head(orgId: string): Promise<{ seq: number; hash: string }> {
    const last = await this.prisma.auditLogEntry.findFirst({
      where: { organizationId: orgId, seq: { not: null } },
      orderBy: { seq: 'desc' },
      select: { seq: true, hash: true },
    });
    if (last?.seq) return { seq: last.seq, hash: last.hash! };
    const anchor = await this.prisma.auditSeal.findFirst({
      where: { organizationId: orgId, kind: 'ANCHOR' },
      orderBy: { seq: 'desc' },
    });
    return anchor ? { seq: anchor.seq, hash: anchor.hash } : { seq: 0, hash: GENESIS_HASH };
  }

  /** Walks the whole chain and reports the first break (edited, removed or re-hashed rows). */
  async verify(orgId: string): Promise<VerifyResult> {
    const seals = await this.prisma.auditSeal.findMany({ where: { organizationId: orgId }, orderBy: { seq: 'asc' } });
    const first = await this.prisma.auditLogEntry.findFirst({
      where: { organizationId: orgId, seq: { not: null } },
      orderBy: { seq: 'asc' },
      select: { seq: true },
    });
    // the chain resumes after the last row purged by retention
    const anchors = seals.filter((s) => s.kind === 'ANCHOR');
    const anchor = first?.seq
      ? first.seq > 1 ? anchors.filter((s) => s.seq === first.seq! - 1).pop() : undefined
      : anchors.pop(); // every row purged: the chain ends at the last anchor
    const start = anchor ? { seq: anchor.seq, hash: anchor.hash } : { seq: 0, hash: GENESIS_HASH };
    const verifier = new ChainVerifier(start, new Set(seals.map((s) => s.seq)));
    let after = start.seq;
    if (first?.seq && first.seq > 1 && !anchor) after = 0; // purged without an anchor: the gap will show
    for (;;) {
      const batch = await this.rows(orgId, after);
      for (const r of batch) verifier.push({ ...r, seq: Number(r.seq) });
      if (batch.length < BATCH) break;
      after = Number(batch[batch.length - 1].seq);
    }
    const result = { ...verifier.finish(seals), verifiedAt: new Date().toISOString() };
    await this.redis.client.set(verifyKey(orgId), JSON.stringify(result), 'EX', 3 * 86_400).catch(() => undefined);
    if (!result.ok) this.logger.error(`AUDIT_CHAIN_BROKEN org=${orgId} ${JSON.stringify(result.firstBreak)}`);
    return result;
  }

  /** Last verification result (overview), without walking the chain again. */
  async lastVerification(orgId: string): Promise<VerifyResult | null> {
    const raw = await this.redis.client.get(verifyKey(orgId)).catch(() => null);
    return raw ? (JSON.parse(raw) as VerifyResult) : null;
  }

  /** Records the chain head as a seal and prints it for log shipping (the copy outside the database). */
  async seal(orgId: string, kind: 'DAILY' | 'EXPORT', actorId: string | null = null) {
    const head = await this.head(orgId);
    if (kind === 'DAILY') {
      const last = await this.prisma.auditSeal.findFirst({ where: { organizationId: orgId, kind: { not: 'ANCHOR' } }, orderBy: { createdAt: 'desc' } });
      if (last && last.seq === head.seq) return last;
    }
    const seal = await this.prisma.auditSeal.create({
      data: { organizationId: orgId, kind, seq: head.seq, hash: head.hash, createdById: actorId },
    });
    this.logger.log(`AUDIT_SEAL org=${orgId} kind=${kind} seq=${head.seq} hash=${head.hash}`);
    return seal;
  }

  async lastSeal(orgId: string) {
    return this.prisma.auditSeal.findFirst({ where: { organizationId: orgId, kind: { not: 'ANCHOR' } }, orderBy: { createdAt: 'desc' } });
  }

  /**
   * Extract for an auditor: every row of the period with its seq / prevHash / hash, plus a manifest
   * holding the chain head (also sealed). The auditor keeps the manifest: a later rewrite of the
   * chain no longer matches it.
   */
  async export(orgId: string, actorId: string, range: { from?: Date; to?: Date }) {
    const verification = await this.verify(orgId);
    const seal = await this.seal(orgId, 'EXPORT', actorId);
    const rows = await this.prisma.auditLogEntry.findMany({
      where: {
        organizationId: orgId,
        createdAt: { ...(range.from ? { gte: range.from } : {}), ...(range.to ? { lte: range.to } : {}) },
      },
      orderBy: { seq: 'asc' },
      take: EXPORT_MAX_ROWS,
    });
    const actorIds = [...new Set(rows.map((r) => r.actorId).filter(Boolean) as string[])];
    const users = await this.prisma.user.findMany({ where: { id: { in: actorIds } }, select: { id: true, email: true } });
    const emails = new Map(users.map((u) => [u.id, u.email]));
    const manifest: ExportManifest = {
      organizationId: orgId,
      exportedAt: new Date().toISOString(),
      from: range.from?.toISOString() ?? null,
      to: range.to?.toISOString() ?? null,
      entries: rows.length,
      firstSeq: rows[0]?.seq ?? null,
      lastSeq: rows[rows.length - 1]?.seq ?? null,
      head: { seq: seal.seq, hash: seal.hash },
      verification: { ok: verification.ok, firstBreak: verification.firstBreak, entries: verification.entries },
      howToVerify:
        'Each row: hash = sha256(prevHash|seq|id|organizationId|actorId|action|entityType|entityId|ip|userAgent|impersonatedById|createdAt|bodyDigest), prevHash = hash of the previous seq. Keep this manifest: the head must still be found in the chain later.',
    };
    const entries = rows.map((r) => ({
      seq: r.seq,
      createdAt: r.createdAt.toISOString(),
      actorId: r.actorId,
      actorEmail: r.actorId ? (emails.get(r.actorId) ?? null) : null,
      viaSupport: !!r.impersonatedById,
      action: r.action,
      entityType: r.entityType,
      entityId: r.entityId,
      ip: r.ip,
      redacted: !!r.redactedAt,
      bodyDigest: r.bodyDigest,
      prevHash: r.prevHash,
      hash: r.hash,
    }));
    return { manifest, entries };
  }

  /**
   * Erasure: empties the request bodies of the audit rows about these records. The trigger accepts
   * this one UPDATE shape only; the hash covers the body digest, so the chain still verifies.
   */
  async redactEntities(orgId: string, entityIds: string[], tx?: Prisma.TransactionClient): Promise<number> {
    if (!entityIds.length) return 0;
    const run = async (t: Prisma.TransactionClient) => {
      await t.$queryRaw`SELECT set_config('astro.audit_redact', 'on', true)`;
      return t.$executeRaw`
        UPDATE "AuditLogEntry" SET "before" = NULL, "after" = NULL, "redactedAt" = now()
         WHERE "organizationId" = ${orgId} AND "entityId" = ANY(${entityIds}) AND "redactedAt" IS NULL`;
    };
    return tx ? run(tx) : this.prisma.$transaction((t) => run(t));
  }

  /**
   * Retention: deletes rows older than `cutoff`. The last purged row is kept as an ANCHOR seal first,
   * so the first remaining row still links to something verifiable.
   */
  async purgeBefore(orgId: string, cutoff: Date): Promise<number> {
    return this.prisma.$transaction(async (t) => {
      const last = await t.auditLogEntry.findFirst({
        where: { organizationId: orgId, createdAt: { lt: cutoff }, seq: { not: null } },
        orderBy: { seq: 'desc' },
        select: { seq: true, hash: true },
      });
      if (!last?.seq) return 0;
      await t.auditSeal.create({ data: { organizationId: orgId, kind: 'ANCHOR', seq: last.seq, hash: last.hash! } });
      await t.$queryRaw`SELECT set_config('astro.audit_retention', 'on', true)`;
      return t.$executeRaw`DELETE FROM "AuditLogEntry" WHERE "organizationId" = ${orgId} AND seq <= ${last.seq}`;
    });
  }

  /** Rows older than `cutoff` (retention preview). */
  countBefore(orgId: string, cutoff: Date) {
    return this.prisma.auditLogEntry.count({ where: { organizationId: orgId, createdAt: { lt: cutoff } } });
  }
}

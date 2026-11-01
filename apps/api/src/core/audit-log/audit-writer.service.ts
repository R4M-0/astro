import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';

export interface AuditWrite {
  organizationId: string | null;
  actorId: string | null;
  /** `<METHOD> <route>` for requests, `ACCESS <route>`, `EXPORT <route>`, `COMPLIANCE <event>` */
  action: string;
  entityType?: string | null;
  entityId?: string | null;
  ip?: string | null;
  userAgent?: string | null;
  impersonatedById?: string | null;
  after?: object | null;
}

const failuresKey = (orgId: string | null) => `astro:audit:write-failures:${orgId ?? '-'}`;

/**
 * The only way the API writes the audit trail. Writes are awaited (the caller decides whether to
 * block on them) and retried once; a write that still fails is logged at error level with the
 * entry and counted per organization, so a lost entry is never silent (compliance overview).
 * The hash chain itself is computed by Postgres (`audit_chain_before_insert`).
 */
@Injectable()
export class AuditWriter {
  private readonly logger = new Logger('AuditWriter');

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  async write(entry: AuditWrite): Promise<boolean> {
    const data: Prisma.AuditLogEntryUncheckedCreateInput = {
      organizationId: entry.organizationId,
      actorId: entry.actorId,
      action: entry.action.slice(0, 500),
      entityType: entry.entityType ?? null,
      entityId: entry.entityId ?? null,
      ip: entry.ip ?? null,
      userAgent: entry.userAgent?.slice(0, 300) ?? null,
      impersonatedById: entry.impersonatedById ?? null,
      after: entry.after ?? undefined,
    };
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        await this.prisma.auditLogEntry.create({ data, select: { id: true } });
        return true;
      } catch (err) {
        if (attempt === 1) {
          this.logger.error(
            `AUDIT_WRITE_FAILED ${JSON.stringify({ ...data, after: undefined })}: ${(err as Error).message}`,
          );
          await this.redis.client.incr(failuresKey(entry.organizationId)).catch(() => undefined);
        }
      }
    }
    return false;
  }

  /** Entries that could not be written for this organization (since Redis was last flushed). */
  async failures(orgId: string): Promise<number> {
    const v = await this.redis.client.get(failuresKey(orgId)).catch(() => null);
    return Number(v ?? 0);
  }
}

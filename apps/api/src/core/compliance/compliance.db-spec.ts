/**
 * Compliance gates against a real Postgres (docs/compliance):
 *  - the audit chain is computed by the database, verified independently, and every tampering shows
 *  - erasure leaves no personal value in the record, its history or its audit bodies, and the chain still verifies
 *  - legal holds and running contracts block erasure; retention only touches enabled categories
 * Run: pnpm --filter @astro/api eval:gates (uses DATABASE_URL; creates and deletes its own organization).
 */
import { ConflictException } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { runWithHistoryContext } from '../history/history-context';
import { AuditChainService } from '../audit-log/audit-chain.service';
import { AuditWriter } from '../audit-log/audit-writer.service';
import { AnonymizerService } from './anonymizer.service';
import { DataSubjectRequestsService } from './data-subject-requests.service';
import { RetentionService } from './retention.service';

jest.setTimeout(60_000);

const prisma = new PrismaService();
const store = new Map<string, string>();
const redis = {
  client: {
    get: async (k: string) => store.get(k) ?? null,
    set: async (k: string, v: string) => (store.set(k, v), 'OK'),
    incr: async (k: string) => (store.set(k, String(Number(store.get(k) ?? 0) + 1)), 1),
  },
};
const deletedObjects: string[] = [];
const deletedVectors: string[] = [];
const writer = new AuditWriter(prisma, redis as never);
const chain = new AuditChainService(prisma, redis as never);
const anonymizer = new AnonymizerService(
  prisma,
  chain,
  writer,
  { deleteObject: async (k: string) => void deletedObjects.push(k) } as never,
  { deleteCandidate: async (id: string) => void deletedVectors.push(id) } as never,
);
const requests = new DataSubjectRequestsService(prisma, anonymizer);
const retention = new RetentionService(prisma, anonymizer, chain, writer);

const tag = randomBytes(4).toString('hex');
let orgId: string;
let userId: string;
const DAY = 86_400_000;

/** Runs `sql` with the append-only guard switched off: what a database owner could do. */
async function asOwner(sql: string) {
  await prisma.$transaction([
    prisma.$executeRawUnsafe('ALTER TABLE "AuditLogEntry" DISABLE TRIGGER audit_log_guard'),
    prisma.$executeRawUnsafe(sql),
    prisma.$executeRawUnsafe('ALTER TABLE "AuditLogEntry" ENABLE TRIGGER audit_log_guard'),
  ]);
}

const audit = (action: string, entityId: string | null = null, after: object | null = null) =>
  writer.write({ organizationId: orgId, actorId: userId, action, entityType: entityId ? 'Employee' : null, entityId, after });

/** Writes like a request would: the history extension records the diff under this actor. */
const asRequest = <T>(fn: () => Promise<T>) =>
  runWithHistoryContext({ actorId: userId, organizationId: orgId, deleteEvents: [], touched: [] } as never, fn);

async function employee(data: Record<string, unknown> = {}) {
  const ref = `EMP-${randomBytes(3).toString('hex')}`;
  return asRequest(() =>
    prisma.employee.create({
      data: { organizationId: orgId, reference: ref, firstName: 'Ines', lastName: `Durand${tag}`, email: `ines.${tag}@aurora.test`, cin: '09876543', ...data },
    }),
  );
}

beforeAll(async () => {
  const org = await prisma.organization.create({ data: { name: `Compliance ${tag}`, slug: `compliance-${tag}` } });
  orgId = org.id;
  const user = await prisma.user.create({ data: { email: `dpo.${tag}@aurora.test`, passwordHash: 'x', firstName: 'Data', lastName: 'Officer' } });
  userId = user.id;
});

afterAll(async () => {
  const where = { organizationId: orgId };
  await prisma.$transaction(async (t) => {
    await t.$queryRaw`SELECT set_config('astro.audit_retention', 'on', true)`;
    await t.$executeRaw`DELETE FROM "AuditLogEntry" WHERE "organizationId" = ${orgId}`;
  });
  await prisma.$transaction([
    prisma.$executeRawUnsafe('ALTER TABLE "AuditSeal" DISABLE TRIGGER audit_seal_guard'),
    prisma.$executeRaw`DELETE FROM "AuditSeal" WHERE "organizationId" = ${orgId}`,
    prisma.$executeRawUnsafe('ALTER TABLE "AuditSeal" ENABLE TRIGGER audit_seal_guard'),
  ]);
  await prisma.historyEntry.deleteMany({ where });
  await prisma.dataSubjectRequest.deleteMany({ where });
  await prisma.legalHold.deleteMany({ where });
  await prisma.retentionRun.deleteMany({ where });
  await prisma.retentionPolicy.deleteMany({ where });
  await prisma.candidateMessage.deleteMany({ where });
  await prisma.candidate.deleteMany({ where });
  await prisma.jobOpening.deleteMany({ where });
  await prisma.employee.deleteMany({ where });
  await prisma.organization.delete({ where: { id: orgId } });
  await prisma.user.delete({ where: { id: userId } });
  await prisma.$disconnect();
});

describe('tamper-evident audit trail', () => {
  it('chains every insert in the database and verifies in Node', async () => {
    for (let i = 0; i < 5; i++) await audit(`POST /api/v1/test/${i}`, null, { i });
    const rows = await prisma.auditLogEntry.findMany({ where: { organizationId: orgId }, orderBy: { seq: 'asc' } });
    expect(rows.map((r) => r.seq)).toEqual([1, 2, 3, 4, 5]);
    expect(rows[1].prevHash).toBe(rows[0].hash);
    const res = await chain.verify(orgId);
    expect(res).toMatchObject({ ok: true, entries: 5, head: { seq: 5, hash: rows[4].hash } });
  });

  it('keeps a gap-free sequence under 20 concurrent writers', async () => {
    await Promise.all(Array.from({ length: 20 }, (_, i) => audit(`POST /api/v1/concurrent/${i}`)));
    const seqs = (await prisma.auditLogEntry.findMany({ where: { organizationId: orgId }, select: { seq: true }, orderBy: { seq: 'asc' } })).map((r) => r.seq);
    expect(seqs).toEqual(Array.from({ length: 25 }, (_, i) => i + 1));
    expect((await chain.verify(orgId)).ok).toBe(true);
  });

  it('refuses UPDATE, DELETE and TRUNCATE from the application', async () => {
    await expect(prisma.$executeRaw`UPDATE "AuditLogEntry" SET action = 'x' WHERE "organizationId" = ${orgId}`).rejects.toThrow(/append-only/);
    await expect(prisma.$executeRaw`DELETE FROM "AuditLogEntry" WHERE "organizationId" = ${orgId}`).rejects.toThrow(/append-only/);
    await expect(prisma.$executeRawUnsafe('TRUNCATE "AuditLogEntry"')).rejects.toThrow(/append-only/);
  });

  it('a seal survives as the copy outside the database', async () => {
    const seal = await chain.seal(orgId, 'DAILY');
    expect(seal.seq).toBe(25);
    expect(await chain.seal(orgId, 'DAILY')).toMatchObject({ id: seal.id }); // head unchanged: no new seal
    await expect(prisma.auditSeal.deleteMany({ where: { organizationId: orgId } })).rejects.toThrow(/append-only/);
    await expect(prisma.auditSeal.update({ where: { id: seal.id }, data: { hash: 'f'.repeat(64) } })).rejects.toThrow(/append-only/);
  });

  it('detects an edited row even when the guard is bypassed by the owner', async () => {
    const r7 = await prisma.auditLogEntry.findFirstOrThrow({ where: { organizationId: orgId, seq: 7 } });
    await asOwner(`UPDATE "AuditLogEntry" SET action = 'POST /api/v1/forged' WHERE id = '${r7.id}'`);
    expect((await chain.verify(orgId)).firstBreak).toMatchObject({ seq: 7, reason: 'hash' });
    await asOwner(`UPDATE "AuditLogEntry" SET action = '${r7.action}' WHERE id = '${r7.id}'`);
    expect((await chain.verify(orgId)).ok).toBe(true);
  });

  it('detects a cut tail through the seal, and a deleted row through the gap', async () => {
    await asOwner(`DELETE FROM "AuditLogEntry" WHERE "organizationId" = '${orgId}' AND seq = 25`);
    expect((await chain.verify(orgId)).firstBreak).toMatchObject({ seq: 25, reason: 'seal' });
    await asOwner(`DELETE FROM "AuditLogEntry" WHERE "organizationId" = '${orgId}' AND seq = 12`);
    expect((await chain.verify(orgId)).firstBreak).toMatchObject({ seq: 12, reason: 'gap' });
  });
});

describe('erasure and retention', () => {
  // the tamper tests above left a broken chain on purpose: start the next tests on a fresh one
  beforeAll(async () => {
    await prisma.$transaction(async (t) => {
      await t.$queryRaw`SELECT set_config('astro.audit_retention', 'on', true)`;
      await t.$executeRaw`DELETE FROM "AuditLogEntry" WHERE "organizationId" = ${orgId}`;
    });
    await prisma.$transaction([
      prisma.$executeRawUnsafe('ALTER TABLE "AuditSeal" DISABLE TRIGGER audit_seal_guard'),
      prisma.$executeRaw`DELETE FROM "AuditSeal" WHERE "organizationId" = ${orgId}`,
      prisma.$executeRawUnsafe('ALTER TABLE "AuditSeal" ENABLE TRIGGER audit_seal_guard'),
    ]);
  });

  it('refuses erasure while the contract runs, then anonymizes everything personal', async () => {
    const emp = await employee({ active: true });
    await asRequest(() => prisma.employee.update({ where: { id: emp.id }, data: { contact: '+33 6 11 22 33 44', exitReason: `Burn-out ${tag}` } }));
    await audit('PATCH /api/v1/hr/employees/:id', emp.id, { firstName: 'Ines', cin: '••••43', contact: '+33 6 11 22 33 44' });
    await audit('ACCESS /api/v1/hr/employees/:id', emp.id);

    const dsr = await requests.create(orgId, userId, { type: 'ERASURE', subjectType: 'EMPLOYEE', subjectId: emp.id, requesterEmail: `ines.${tag}@aurora.test` });
    expect(dsr.reference).toBe('DSR-0001');
    expect(dsr.dueAt.getTime() - dsr.receivedAt.getTime()).toBe(30 * DAY);
    await expect(requests.execute(orgId, userId, dsr.id)).rejects.toBeInstanceOf(ConflictException);

    // a legal hold wins even after the departure
    await prisma.employee.update({ where: { id: emp.id }, data: { active: false, exitDate: new Date(Date.now() - DAY) } });
    const hold = await prisma.legalHold.create({ data: { organizationId: orgId, subjectType: 'EMPLOYEE', subjectId: emp.id, subjectLabel: emp.reference, reason: 'Prud’hommes' } });
    await expect(requests.execute(orgId, userId, dsr.id)).rejects.toThrow(/Gel juridique/);
    await prisma.legalHold.update({ where: { id: hold.id }, data: { releasedAt: new Date() } });

    // access export first (Art. 15): it contains the file and who opened it
    const access = await requests.create(orgId, userId, { type: 'ACCESS', subjectType: 'EMPLOYEE', subjectId: emp.id });
    const exported = (await requests.export(orgId, access.id)) as unknown as { data: { employee: Record<string, unknown>; accessLog: { action: string }[] } };
    expect(exported.data.employee.email).toBe(`ines.${tag}@aurora.test`);
    expect(exported.data.accessLog.some((l) => l.action.startsWith('ACCESS '))).toBe(true);

    const done = await requests.execute(orgId, userId, dsr.id);
    expect(done.status).toBe('COMPLETED');
    expect(done.subjectLabel).toBe(emp.reference); // the proof keeps the reference, never the name

    const after = await prisma.employee.findUniqueOrThrow({ where: { id: emp.id } });
    expect(after).toMatchObject({ firstName: 'Anonyme', lastName: emp.reference, email: null, cin: null, contact: null, exitReason: null });
    expect(after.anonymizedAt).not.toBeNull();

    // nothing personal left in history (including the diff of the anonymization itself)
    await new Promise((r) => setTimeout(r, 300)); // history capture is asynchronous
    const history = JSON.stringify(await prisma.historyEntry.findMany({ where: { organizationId: orgId, entityId: emp.id } }));
    for (const value of [`Durand${tag}`, `ines.${tag}@aurora.test`, '09876543', '+33 6 11 22 33 44', `Burn-out ${tag}`]) {
      expect(history).not.toContain(value);
    }
    // audit bodies about the person are erased, and the chain still verifies
    const rows = await prisma.auditLogEntry.findMany({ where: { organizationId: orgId, entityId: emp.id } });
    expect(rows.filter((r) => r.action.startsWith('PATCH')).every((r) => r.after === null && r.redactedAt)).toBe(true);
    expect(rows.some((r) => r.action === 'COMPLIANCE subject.anonymized')).toBe(true);
    const v = await chain.verify(orgId);
    expect(v.ok).toBe(true);
    expect(v.redacted).toBeGreaterThan(0);

    // idempotent
    const again = await anonymizer.anonymize(orgId, 'EMPLOYEE', emp.id, { actorId: userId, reason: 'test' });
    expect(again.alreadyAnonymized).toBe(true);
  });

  it('anonymizes a candidate: CV file, vector, text and evidence quotes', async () => {
    const opening = await prisma.jobOpening.create({ data: { organizationId: orgId, title: 'Technicien', description: 'x', status: 'CLOSED' } });
    const cand = await prisma.candidate.create({
      data: {
        organizationId: orgId, jobOpeningId: opening.id, fileKey: `cv/${tag}.pdf`, fileName: 'jane-doe.pdf', mimeType: 'application/pdf', fileSize: 10,
        fullName: 'Jane Doe', email: `jane.${tag}@mail.test`, cvText: 'Jane Doe, 10 ans de maintenance', decision: 'REJECTED',
        criteriaScores: [{ id: 'c1', score: 3, evidence: 'Jane Doe a dirigé' }],
      },
    });
    await prisma.candidateMessage.create({ data: { organizationId: orgId, candidateId: cand.id, direction: 'OUT', kind: 'REJECTION', status: 'SENT', subject: 'Votre candidature', body: 'Bonjour Jane Doe' } });
    const res = await anonymizer.anonymize(orgId, 'CANDIDATE', cand.id, { actorId: userId, reason: 'test' });
    expect(res.related.messages).toBe(1);
    const c = await prisma.candidate.findUniqueOrThrow({ where: { id: cand.id } });
    expect(c).toMatchObject({ fullName: null, email: null, cvText: null, criteriaScores: null, fileName: 'anonymized' });
    expect(deletedObjects).toContain(`cv/${tag}.pdf`);
    expect(deletedVectors).toContain(cand.id);
    const m = await prisma.candidateMessage.findFirstOrThrow({ where: { candidateId: cand.id } });
    expect(m.body).toBe('');
  });

  it('retention: dry run counts, live run only applies enabled categories and skips held subjects', async () => {
    const old = new Date(Date.now() - 6 * 365 * DAY);
    const due1 = await employee({ active: false, exitDate: old });
    const due2 = await employee({ active: false, exitDate: old });
    await employee({ active: false, exitDate: new Date(Date.now() - 30 * DAY) }); // left last month: kept
    await prisma.legalHold.create({ data: { organizationId: orgId, subjectType: 'EMPLOYEE', subjectId: due2.id, subjectLabel: due2.reference, reason: 'Inspection du travail' } });

    const dry = await retention.run(orgId, { dryRun: true, actorId: userId });
    const dryRes = dry.results as Record<string, { due: number; held: number; applied: number }>;
    expect(dryRes.FORMER_EMPLOYEE).toMatchObject({ due: 2, held: 1, applied: 0 });

    // disabled by default: a live run changes nothing
    await retention.run(orgId, { dryRun: false, actorId: null });
    expect((await prisma.employee.findUniqueOrThrow({ where: { id: due1.id } })).anonymizedAt).toBeNull();

    await retention.update(orgId, userId, 'FORMER_EMPLOYEE', { enabled: true });
    const live = await retention.run(orgId, { dryRun: false, actorId: null });
    expect((live.results as Record<string, { applied: number }>).FORMER_EMPLOYEE.applied).toBe(1);
    expect((await prisma.employee.findUniqueOrThrow({ where: { id: due1.id } })).anonymizedAt).not.toBeNull();
    expect((await prisma.employee.findUniqueOrThrow({ where: { id: due2.id } })).anonymizedAt).toBeNull();
    expect(await prisma.auditLogEntry.count({ where: { organizationId: orgId, action: 'COMPLIANCE retention.run' } })).toBe(1);
  });

  it('retention purge of the audit log keeps the chain verifiable through an anchor', async () => {
    const before = await chain.verify(orgId);
    const seqs = await prisma.auditLogEntry.findMany({ where: { organizationId: orgId }, select: { id: true, seq: true }, orderBy: { seq: 'asc' } });
    const cut = seqs[Math.floor(seqs.length / 2)];
    // age the first half (owner-level backdating, test only)
    await asOwner(`UPDATE "AuditLogEntry" SET "createdAt" = now() - interval '7 years' WHERE "organizationId" = '${orgId}' AND seq <= ${cut.seq}`);
    // backdating changed a hashed column: re-hash those rows as the trigger would have
    await prisma.$executeRawUnsafe(`ALTER TABLE "AuditLogEntry" DISABLE TRIGGER audit_log_guard`);
    try {
      let prev = '0'.repeat(64);
      for (const s of seqs) {
        await prisma.$executeRaw`
          UPDATE "AuditLogEntry" SET "prevHash" = ${prev}, hash = audit_row_hash(${prev}, seq, id, "organizationId", "actorId", action,
                 "entityType", "entityId", ip, "userAgent", "impersonatedById", "createdAt", "bodyDigest")
           WHERE id = ${s.id}`;
        prev = (await prisma.auditLogEntry.findUniqueOrThrow({ where: { id: s.id } })).hash!;
      }
    } finally {
      await prisma.$executeRawUnsafe(`ALTER TABLE "AuditLogEntry" ENABLE TRIGGER audit_log_guard`);
    }
    expect((await chain.verify(orgId)).ok).toBe(true);

    const purged = await chain.purgeBefore(orgId, new Date(Date.now() - 6 * 365 * DAY));
    expect(purged).toBe(cut.seq);
    const res = await chain.verify(orgId);
    expect(res.ok).toBe(true);
    expect(res.entries).toBe(before.entries - cut.seq!);
    // new writes continue the chain after the purge
    await audit('POST /api/v1/after-purge');
    expect((await chain.verify(orgId)).ok).toBe(true);
  });
});

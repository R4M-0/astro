import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { DataSubjectType } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditChainService } from '../audit-log/audit-chain.service';
import { AuditWriter } from '../audit-log/audit-writer.service';
import { unscoped } from '../department-scope/department-scope';
import { DataSubjectRequestsService } from './data-subject-requests.service';
import { PROCESSING_ACTIVITIES } from './processing-register';
import { RETENTION_CATEGORIES, RetentionService } from './retention.service';

const HOUR = 3_600_000;

export type CheckStatus = 'ok' | 'warn' | 'fail';
export interface ComplianceCheck {
  key: 'chain' | 'seal' | 'writes' | 'retention' | 'requests';
  status: CheckStatus;
  /** numbers the UI words in its own language */
  data: Record<string, unknown>;
}

@Injectable()
export class ComplianceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly chain: AuditChainService,
    private readonly writer: AuditWriter,
    private readonly retention: RetentionService,
    private readonly requests: DataSubjectRequestsService,
  ) {}

  /** Everything a DPO checks on Monday morning, each line with a status. */
  async overview(orgId: string) {
    const now = new Date();
    const [verification, lastSeal, head, failures, policies, lastRun, openRequests, holds, people] = await Promise.all([
      this.chain.lastVerification(orgId),
      this.chain.lastSeal(orgId),
      this.chain.head(orgId),
      this.writer.failures(orgId),
      this.retention.policies(orgId),
      this.prisma.retentionRun.findFirst({ where: { organizationId: orgId, dryRun: false }, orderBy: { startedAt: 'desc' } }),
      this.prisma.dataSubjectRequest.findMany({ where: { organizationId: orgId, status: 'OPEN', deletedAt: null }, select: { dueAt: true } }),
      this.prisma.legalHold.count({ where: { organizationId: orgId, releasedAt: null } }),
      unscoped(() =>
        Promise.all([
          this.prisma.employee.count({ where: { organizationId: orgId, deletedAt: null, active: true } }),
          this.prisma.employee.count({ where: { organizationId: orgId, active: false, anonymizedAt: null } }),
          this.prisma.candidate.count({ where: { organizationId: orgId, anonymizedAt: null } }),
          this.prisma.employee.count({ where: { organizationId: orgId, anonymizedAt: { not: null } } }),
          this.prisma.candidate.count({ where: { organizationId: orgId, anonymizedAt: { not: null } } }),
        ]),
      ),
    ]);
    const overdue = openRequests.filter((r) => r.dueAt < now).length;
    const dueSoon = openRequests.filter((r) => r.dueAt >= now && r.dueAt.getTime() - now.getTime() < 7 * 24 * HOUR).length;
    const enabled = policies.filter((p) => p.enabled).length;
    const sealAgeH = lastSeal ? Math.round((now.getTime() - lastSeal.createdAt.getTime()) / HOUR) : null;

    const checks: ComplianceCheck[] = [
      {
        key: 'chain',
        status: !verification ? 'warn' : verification.ok ? 'ok' : 'fail',
        data: { verifiedAt: verification?.verifiedAt ?? null, entries: verification?.entries ?? null, firstBreak: verification?.firstBreak ?? null },
      },
      { key: 'seal', status: sealAgeH !== null && sealAgeH <= 48 ? 'ok' : 'warn', data: { ageHours: sealAgeH, seq: lastSeal?.seq ?? null } },
      { key: 'writes', status: failures ? 'fail' : 'ok', data: { failures } },
      { key: 'retention', status: enabled === RETENTION_CATEGORIES.length ? 'ok' : 'warn', data: { enabled, total: RETENTION_CATEGORIES.length } },
      { key: 'requests', status: overdue ? 'fail' : dueSoon ? 'warn' : 'ok', data: { open: openRequests.length, overdue, dueSoon } },
    ];
    return {
      checks,
      audit: { head, lastSeal: lastSeal ? { seq: lastSeal.seq, hash: lastSeal.hash, createdAt: lastSeal.createdAt } : null, verification, writeFailures: failures },
      retention: { enabled, total: RETENTION_CATEGORIES.length, lastRun },
      requests: { open: openRequests.length, overdue, dueSoon },
      legalHolds: holds,
      personalData: { activeEmployees: people[0], formerEmployees: people[1], candidates: people[2], anonymized: people[3] + people[4] },
    };
  }

  /** People a request or a hold can be about: employees and candidates by name, e-mail or reference. */
  async subjects(orgId: string, search: string) {
    const q = search.trim();
    if (q.length < 2) return [];
    return unscoped(async () => {
      const [employees, candidates] = await Promise.all([
        this.prisma.employee.findMany({
          where: {
            organizationId: orgId,
            OR: [
              { firstName: { contains: q, mode: 'insensitive' } },
              { lastName: { contains: q, mode: 'insensitive' } },
              { email: { contains: q, mode: 'insensitive' } },
              { reference: { contains: q, mode: 'insensitive' } },
            ],
          },
          select: { id: true, reference: true, firstName: true, lastName: true, email: true, active: true, exitDate: true, anonymizedAt: true, deletedAt: true },
          take: 10,
          orderBy: { lastName: 'asc' },
        }),
        this.prisma.candidate.findMany({
          where: {
            organizationId: orgId,
            OR: [{ fullName: { contains: q, mode: 'insensitive' } }, { email: { contains: q, mode: 'insensitive' } }],
          },
          select: { id: true, fullName: true, email: true, decision: true, anonymizedAt: true, jobOpening: { select: { title: true } } },
          take: 10,
          orderBy: { createdAt: 'desc' },
        }),
      ]);
      return [
        ...employees.map((e) => ({
          type: 'EMPLOYEE' as DataSubjectType,
          id: e.id,
          label: `${e.reference} ${e.firstName} ${e.lastName}`,
          email: e.email,
          status: e.anonymizedAt ? 'anonymized' : e.deletedAt ? 'deleted' : e.active ? 'active' : 'former',
        })),
        ...candidates.map((c) => ({
          type: 'CANDIDATE' as DataSubjectType,
          id: c.id,
          label: `${c.fullName ?? c.email ?? `CAND-${c.id.slice(0, 8)}`} — ${c.jobOpening.title}`,
          email: c.email,
          status: c.anonymizedAt ? 'anonymized' : c.decision.toLowerCase(),
        })),
      ];
    });
  }

  // ── legal holds ─────────────────────────────────────────────────────────
  listHolds(orgId: string, all = false) {
    return this.prisma.legalHold.findMany({
      where: { organizationId: orgId, ...(all ? {} : { releasedAt: null }) },
      orderBy: { createdAt: 'desc' },
    });
  }

  async createHold(orgId: string, actorId: string, dto: { subjectType: DataSubjectType; subjectId: string; reason: string }) {
    if (!dto.reason?.trim()) throw new BadRequestException('Le motif du gel est obligatoire');
    const existing = await this.prisma.legalHold.findFirst({
      where: { organizationId: orgId, subjectType: dto.subjectType, subjectId: dto.subjectId, releasedAt: null },
    });
    if (existing) throw new ConflictException('Un gel juridique est déjà actif pour cette personne');
    const subjectLabel = await this.requests.subjectLabel(orgId, dto.subjectType, dto.subjectId);
    return this.prisma.legalHold.create({
      data: { organizationId: orgId, subjectType: dto.subjectType, subjectId: dto.subjectId, subjectLabel, reason: dto.reason.trim(), createdById: actorId },
    });
  }

  async releaseHold(orgId: string, actorId: string, id: string) {
    const hold = await this.prisma.legalHold.findFirst({ where: { id, organizationId: orgId } });
    if (!hold) throw new NotFoundException('Gel juridique introuvable');
    if (hold.releasedAt) throw new ConflictException('Ce gel est déjà levé');
    return this.prisma.legalHold.update({ where: { id }, data: { releasedAt: new Date(), releasedById: actorId } });
  }

  // ── record of processing ────────────────────────────────────────────────
  async processingRegister(orgId: string) {
    const policies = await this.retention.policies(orgId);
    return PROCESSING_ACTIVITIES.map((a) => {
      const p = a.retentionPolicy ? policies.find((x) => x.category === a.retentionPolicy) : undefined;
      return { ...a, policy: p ? { category: p.category, retentionDays: p.retentionDays, enabled: p.enabled } : null };
    });
  }
}

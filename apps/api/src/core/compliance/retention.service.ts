import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { Prisma, RetentionAction, RetentionCategory, RetentionPolicy } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditChainService } from '../audit-log/audit-chain.service';
import { AuditWriter } from '../audit-log/audit-writer.service';
import { unscoped } from '../department-scope/department-scope';
import { AnonymizerService } from './anonymizer.service';

const DAY = 86_400_000;
/** Subjects anonymized per category and run: the rest waits for the next day. */
const BATCH = 200;

/** Defaults (France, CNIL guidance). They start disabled: an admin enables each after the dry run. */
export const RETENTION_DEFAULTS: Record<RetentionCategory, { retentionDays: number; action: RetentionAction; min: number }> = {
  CANDIDATE_NOT_HIRED: { retentionDays: 730, action: 'ANONYMIZE', min: 30 },
  FORMER_EMPLOYEE: { retentionDays: 1825, action: 'ANONYMIZE', min: 365 },
  SURVEY_IDENTITY: { retentionDays: 730, action: 'ANONYMIZE', min: 30 },
  // the trail outlives what it proves: never below one year
  AUDIT_LOG: { retentionDays: 2190, action: 'PURGE', min: 365 },
};
export const RETENTION_CATEGORIES = Object.keys(RETENTION_DEFAULTS) as RetentionCategory[];

export interface CategoryResult {
  enabled: boolean;
  retentionDays: number;
  cutoff: string;
  /** subjects (or audit rows) past the retention period */
  due: number;
  /** of which under an active legal hold, skipped */
  held: number;
  /** actually anonymized / purged (0 in a dry run) */
  applied: number;
}

/**
 * Storage limitation (GDPR Art. 5(1)(e)). The clock of each category:
 *  - CANDIDATE_NOT_HIRED: last update of a candidate that was rejected, deleted, or whose opening is closed / deleted
 *  - FORMER_EMPLOYEE: exitDate (or deletion) of an employee no longer active
 *  - SURVEY_IDENTITY: submittedAt of a named survey response (answers stay, identity goes)
 *  - AUDIT_LOG: createdAt (purged behind an ANCHOR seal)
 */
@Injectable()
export class RetentionService {
  private readonly logger = new Logger('Retention');

  constructor(
    private readonly prisma: PrismaService,
    private readonly anonymizer: AnonymizerService,
    private readonly chain: AuditChainService,
    private readonly writer: AuditWriter,
  ) {}

  /** The organization's policies, created from the defaults (disabled) on first read. */
  async policies(orgId: string): Promise<RetentionPolicy[]> {
    await this.prisma.retentionPolicy.createMany({
      data: RETENTION_CATEGORIES.map((category) => ({
        organizationId: orgId,
        category,
        retentionDays: RETENTION_DEFAULTS[category].retentionDays,
        action: RETENTION_DEFAULTS[category].action,
      })),
      skipDuplicates: true,
    });
    const rows = await this.prisma.retentionPolicy.findMany({ where: { organizationId: orgId } });
    return RETENTION_CATEGORIES.map((c) => rows.find((r) => r.category === c)!);
  }

  async update(orgId: string, actorId: string, category: RetentionCategory, dto: { retentionDays?: number; enabled?: boolean }) {
    if (!RETENTION_CATEGORIES.includes(category)) throw new BadRequestException('Catégorie inconnue');
    const min = RETENTION_DEFAULTS[category].min;
    if (dto.retentionDays !== undefined && (!Number.isInteger(dto.retentionDays) || dto.retentionDays < min || dto.retentionDays > 36_500)) {
      throw new BadRequestException(`Durée de conservation : entre ${min} et 36500 jours`);
    }
    await this.policies(orgId);
    return this.prisma.retentionPolicy.update({
      where: { organizationId_category: { organizationId: orgId, category } },
      data: { retentionDays: dto.retentionDays, enabled: dto.enabled, updatedById: actorId },
    });
  }

  async runs(orgId: string, take = 10) {
    return this.prisma.retentionRun.findMany({ where: { organizationId: orgId }, orderBy: { startedAt: 'desc' }, take });
  }

  private async heldIds(orgId: string, subjectType: 'EMPLOYEE' | 'CANDIDATE') {
    const holds = await this.prisma.legalHold.findMany({
      where: { organizationId: orgId, subjectType, releasedAt: null },
      select: { subjectId: true },
    });
    return holds.map((h) => h.subjectId);
  }

  private candidatesDue(orgId: string, cutoff: Date): Prisma.CandidateWhereInput {
    return {
      organizationId: orgId,
      anonymizedAt: null,
      updatedAt: { lt: cutoff },
      OR: [
        { decision: 'REJECTED' },
        { deletedAt: { not: null } },
        { jobOpening: { status: 'CLOSED' } },
        { jobOpening: { deletedAt: { not: null } } },
      ],
    };
  }

  private employeesDue(orgId: string, cutoff: Date): Prisma.EmployeeWhereInput {
    return {
      organizationId: orgId,
      anonymizedAt: null,
      OR: [
        { active: false, exitDate: { lt: cutoff } },
        { active: false, exitDate: null, updatedAt: { lt: cutoff } },
        { deletedAt: { lt: cutoff } },
      ],
    };
  }

  private surveysDue(orgId: string, cutoff: Date): Prisma.HrSurveyResponseWhereInput {
    return {
      organizationId: orgId,
      submittedAt: { lt: cutoff },
      OR: [{ respondentName: { not: null } }, { respondentEmail: { not: null } }, { employeeId: { not: null } }],
    };
  }

  /** One failing subject never stops the run: it is logged and retried tomorrow. */
  private async safeAnonymize(orgId: string, type: 'EMPLOYEE' | 'CANDIDATE', id: string, actorId: string | null, reason: string) {
    try {
      await this.anonymizer.anonymize(orgId, type, id, { actorId, reason });
      return true;
    } catch (err) {
      this.logger.error(`anonymize ${type} ${id} failed: ${(err as Error).message}`);
      return false;
    }
  }

  /**
   * Applies (or previews) every policy. A dry run evaluates all categories, enabled or not, so an
   * admin sees what enabling one would do. A live run only touches enabled categories.
   */
  async run(orgId: string, opts: { dryRun: boolean; actorId: string | null; now?: Date }) {
    const now = opts.now ?? new Date();
    const policies = await this.policies(orgId);
    const results: Partial<Record<RetentionCategory, CategoryResult>> = {};
    const run = await this.prisma.retentionRun.create({
      data: { organizationId: orgId, dryRun: opts.dryRun, triggeredById: opts.actorId },
    });
    const [heldEmployees, heldCandidates] = await Promise.all([this.heldIds(orgId, 'EMPLOYEE'), this.heldIds(orgId, 'CANDIDATE')]);

    await unscoped(async () => {
      for (const p of policies) {
        const cutoff = new Date(now.getTime() - p.retentionDays * DAY);
        const apply = !opts.dryRun && p.enabled;
        const r: CategoryResult = { enabled: p.enabled, retentionDays: p.retentionDays, cutoff: cutoff.toISOString(), due: 0, held: 0, applied: 0 };
        const reason = `retention:${p.category}`;
        switch (p.category) {
          case 'CANDIDATE_NOT_HIRED': {
            const where = this.candidatesDue(orgId, cutoff);
            r.due = await this.prisma.candidate.count({ where });
            r.held = heldCandidates.length ? await this.prisma.candidate.count({ where: { AND: [where, { id: { in: heldCandidates } }] } }) : 0;
            if (apply) {
              const ids = await this.prisma.candidate.findMany({ where: { AND: [where, { id: { notIn: heldCandidates } }] }, select: { id: true }, take: BATCH });
              for (const { id } of ids) {
                if (await this.safeAnonymize(orgId, 'CANDIDATE', id, opts.actorId, reason)) r.applied++;
              }
            }
            break;
          }
          case 'FORMER_EMPLOYEE': {
            const where = this.employeesDue(orgId, cutoff);
            r.due = await this.prisma.employee.count({ where });
            r.held = heldEmployees.length ? await this.prisma.employee.count({ where: { AND: [where, { id: { in: heldEmployees } }] } }) : 0;
            if (apply) {
              const ids = await this.prisma.employee.findMany({ where: { AND: [where, { id: { notIn: heldEmployees } }] }, select: { id: true }, take: BATCH });
              for (const { id } of ids) {
                if (await this.safeAnonymize(orgId, 'EMPLOYEE', id, opts.actorId, reason)) r.applied++;
              }
            }
            break;
          }
          case 'SURVEY_IDENTITY': {
            const where = this.surveysDue(orgId, cutoff);
            r.due = await this.prisma.hrSurveyResponse.count({ where });
            r.held = heldEmployees.length ? await this.prisma.hrSurveyResponse.count({ where: { AND: [where, { employeeId: { in: heldEmployees } }] } }) : 0;
            if (apply) {
              const free: Prisma.HrSurveyResponseWhereInput = heldEmployees.length
                ? { AND: [where, { OR: [{ employeeId: null }, { employeeId: { notIn: heldEmployees } }] }] }
                : where;
              const res = await this.prisma.hrSurveyResponse.updateMany({ where: free, data: { respondentName: null, respondentEmail: null, employeeId: null } });
              r.applied = res.count;
            }
            break;
          }
          case 'AUDIT_LOG': {
            r.due = await this.chain.countBefore(orgId, cutoff);
            if (apply && r.due) r.applied = await this.chain.purgeBefore(orgId, cutoff);
            break;
          }
        }
        results[p.category] = r;
      }
    });

    const finished = await this.prisma.retentionRun.update({
      where: { id: run.id },
      data: { results: results as Prisma.InputJsonValue, finishedAt: new Date() },
    });
    if (!opts.dryRun) {
      const sum = (cats: RetentionCategory[], k: keyof CategoryResult) => cats.reduce((n, c) => n + Number(results[c]?.[k] ?? 0), 0);
      const anonymized = sum(['CANDIDATE_NOT_HIRED', 'FORMER_EMPLOYEE'], 'applied');
      const purged = sum(['AUDIT_LOG'], 'applied');
      const surveyIdentities = sum(['SURVEY_IDENTITY'], 'applied');
      const held = sum(RETENTION_CATEGORIES, 'held');
      if (anonymized || purged || surveyIdentities || opts.actorId) {
        await this.writer.write({
          organizationId: orgId,
          actorId: opts.actorId,
          action: 'COMPLIANCE retention.run',
          entityType: 'RetentionRun',
          entityId: run.id,
          after: { anonymized, purged, surveyIdentities, held },
        });
      }
      this.logger.log(`org ${orgId}: anonymized ${anonymized}, survey identities ${surveyIdentities}, audit purged ${purged}, held ${held}`);
    }
    return finished;
  }
}

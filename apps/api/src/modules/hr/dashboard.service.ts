import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

const DAY = 86_400_000;

/**
 * Astro home dashboard: one call, one section per HR register. A section is `null` unless the
 * caller can read that register; department visibility applies through the Prisma extension.
 */
@Injectable()
export class HrDashboardService {
  constructor(private readonly prisma: PrismaService) {}

  async dashboard(orgId: string, granted: Set<string>) {
    const [people, journeys, competencies, trainings, surveys] = await Promise.all([
      granted.has('employees:read') ? this.people(orgId) : null,
      granted.has('employees:read') ? this.journeys(orgId) : null,
      granted.has('competency-evaluations:read') ? this.competencies(orgId) : null,
      granted.has('hr-trainings:read') ? this.trainings(orgId) : null,
      granted.has('hr-surveys:read') ? this.surveys(orgId) : null,
    ]);
    return { people, journeys, competencies, trainings, surveys };
  }

  private async people(orgId: string) {
    const now = new Date();
    const base = { organizationId: orgId, deletedAt: null };
    const [active, inactive, hires, byDepartment, byContract] = await Promise.all([
      this.prisma.employee.count({ where: { ...base, active: true } }),
      this.prisma.employee.count({ where: { ...base, active: false } }),
      this.prisma.employee.count({ where: { ...base, hireDate: { gte: new Date(now.getTime() - 90 * DAY) } } }),
      this.prisma.employee.groupBy({ by: ['departmentId'], where: { ...base, active: true }, _count: { _all: true } }),
      this.prisma.employee.groupBy({ by: ['contractType'], where: { ...base, active: true }, _count: { _all: true } }),
    ]);
    return {
      active,
      inactive,
      hiresLast90Days: hires,
      byDepartment: byDepartment.map((r) => ({ departmentId: r.departmentId, count: r._count._all })),
      byContract: byContract.map((r) => ({ contractType: r.contractType, count: r._count._all })),
    };
  }

  private async journeys(orgId: string) {
    const now = new Date();
    const open = { organizationId: orgId, deletedAt: null, status: 'IN_PROGRESS' as const };
    const [onboarding, offboarding, trialsSoon] = await Promise.all([
      this.prisma.employeeJourney.count({ where: { ...open, kind: 'ONBOARDING' } }),
      this.prisma.employeeJourney.count({ where: { ...open, kind: 'OFFBOARDING' } }),
      this.prisma.employeeJourney.findMany({
        where: { ...open, kind: 'ONBOARDING', targetDate: { lte: new Date(now.getTime() + 30 * DAY) } },
        orderBy: { targetDate: 'asc' },
        take: 6,
        select: {
          id: true,
          reference: true,
          targetDate: true,
          employee: { select: { id: true, firstName: true, lastName: true, jobTitle: true } },
        },
      }),
    ]);
    return { onboarding, offboarding, trialsSoon };
  }

  private async competencies(orgId: string) {
    const where = { organizationId: orgId, employee: { deletedAt: null } };
    const [evaluations, belowExpected, expectedSet, bySkill] = await Promise.all([
      this.prisma.competencyEvaluation.count({ where }),
      this.prisma.competencyEvaluation.count({ where: { ...where, expectedLevel: { not: null }, gap: { lt: 0 } } }),
      this.prisma.competencyEvaluation.count({ where: { ...where, expectedLevel: { not: null } } }),
      this.prisma.competencyEvaluation.groupBy({
        by: ['skillId'],
        where: { ...where, expectedLevel: { not: null }, gap: { lt: 0 } },
        _count: { _all: true },
        orderBy: { _count: { skillId: 'desc' } },
        take: 5,
      }),
    ]);
    const skills = bySkill.length
      ? await this.prisma.skill.findMany({ where: { id: { in: bySkill.map((r) => r.skillId) } }, select: { id: true, name: true } })
      : [];
    const nameOf = new Map(skills.map((s) => [s.id, s.name]));
    return {
      evaluations,
      belowExpected,
      coveragePct: expectedSet ? Math.round(((expectedSet - belowExpected) / expectedSet) * 100) : null,
      topGaps: bySkill.map((r) => ({ skillId: r.skillId, name: nameOf.get(r.skillId) ?? '—', count: r._count._all })),
    };
  }

  private async trainings(orgId: string) {
    const now = new Date();
    const base = { organizationId: orgId, deletedAt: null };
    const yearStart = new Date(Date.UTC(now.getUTCFullYear(), 0, 1));
    const [planned, completedThisYear, upcoming, satisfaction] = await Promise.all([
      this.prisma.hrTraining.count({ where: { ...base, status: { in: ['PLANNED', 'IN_PROGRESS'] } } }),
      this.prisma.hrTraining.count({ where: { ...base, status: 'COMPLETED', endDate: { gte: yearStart } } }),
      this.prisma.hrTraining.findMany({
        where: { ...base, status: { in: ['PLANNED', 'IN_PROGRESS'] }, startDate: { gte: new Date(now.getTime() - DAY) } },
        orderBy: { startDate: 'asc' },
        take: 6,
        select: { id: true, code: true, theme: true, startDate: true, status: true, _count: { select: { participants: true } } },
      }),
      this.prisma.trainingFeedback.aggregate({
        where: { organizationId: orgId, training: { deletedAt: null } },
        _avg: { satisfactionScore: true },
        _count: { _all: true },
      }),
    ]);
    return {
      planned,
      completedThisYear,
      upcoming: upcoming.map(({ _count, ...t }) => ({ ...t, participants: _count.participants })),
      satisfactionAvg: satisfaction._avg.satisfactionScore,
      feedbackCount: satisfaction._count._all,
    };
  }

  private async surveys(orgId: string) {
    const base = { organizationId: orgId, deletedAt: null, scope: 'HR' as const };
    const [published, responses] = await Promise.all([
      this.prisma.hrSurvey.count({ where: { ...base, status: 'PUBLISHED' } }),
      this.prisma.hrSurveyResponse.count({ where: { organizationId: orgId, survey: base } }),
    ]);
    return { published, responses };
  }
}

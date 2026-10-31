import { Injectable } from '@nestjs/common';
import { unscoped } from '../../core/department-scope/department-scope';
import { PrismaService } from '../../prisma/prisma.service';
import { JourneysService } from './journeys.service';

/**
 * « Mon espace » — the signed-in member's own HR record (the Employee linked to their login):
 * profile, job description, competencies vs expected levels, trainings and onboarding plan.
 * Open to every member without HR permissions: every read is keyed to the caller's own
 * employee id, so nothing about other employees is reachable from here.
 */
@Injectable()
export class SelfServiceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly journeys: JourneysService,
  ) {}

  async me(orgId: string, userId: string) {
    // the caller's own record may sit in any process — and it is theirs, so no visibility filter
    return unscoped(async () => {
      const employee = await this.prisma.employee.findFirst({
        where: { organizationId: orgId, userId, deletedAt: null },
        select: {
          id: true, reference: true, firstName: true, lastName: true, jobTitle: true, departmentId: true,
          email: true, contact: true, hireDate: true, contractType: true, trialEndDate: true, active: true,
          manager: { select: { firstName: true, lastName: true, jobTitle: true } },
          assignments: {
            select: {
              assignedAt: true,
              jobDescription: {
                select: {
                  id: true, reference: true, version: true, jobTitle: true, mainMission: true, jobPurpose: true,
                  authority: true, requiredTraining: true, status: true,
                  activities: { select: { id: true, description: true, frequency: true }, orderBy: { sortOrder: 'asc' } },
                  skillRequirements: { select: { skillId: true, requiredLevel: true, skill: { select: { name: true, type: true } } } },
                },
              },
            },
          },
          evaluations: {
            select: { skillId: true, expectedLevel: true, evaluatedLevel: true, gap: true, evaluatedAt: true, skill: { select: { name: true, type: true } } },
          },
          participants: {
            select: {
              present: true,
              training: { select: { id: true, code: true, theme: true, type: true, status: true, startDate: true, endDate: true, deletedAt: true } },
            },
          },
        },
      });
      if (!employee) return { employee: null };

      const { assignments, evaluations, participants, ...profile } = employee;
      const jd = assignments[0]?.jobDescription ?? null;
      const department = profile.departmentId
        ? await this.prisma.department.findFirst({ where: { id: profile.departmentId }, select: { name: true } })
        : null;

      // required skills first (with their expected level), then skills evaluated outside the job description
      const evalBySkill = new Map(evaluations.map((e) => [e.skillId, e]));
      const competencies = [
        ...(jd?.skillRequirements ?? []).map((r) => {
          const ev = evalBySkill.get(r.skillId);
          return {
            skillId: r.skillId, name: r.skill.name, type: r.skill.type, required: true,
            expectedLevel: r.requiredLevel, evaluatedLevel: ev?.evaluatedLevel ?? null,
            gap: ev ? ev.evaluatedLevel - r.requiredLevel : null, evaluatedAt: ev?.evaluatedAt ?? null,
          };
        }),
        ...evaluations
          .filter((e) => !jd?.skillRequirements.some((r) => r.skillId === e.skillId))
          .map((e) => ({
            skillId: e.skillId, name: e.skill.name, type: e.skill.type, required: false,
            expectedLevel: e.expectedLevel, evaluatedLevel: e.evaluatedLevel, gap: e.expectedLevel != null ? e.gap : null, evaluatedAt: e.evaluatedAt,
          })),
      ];

      const trainings = participants
        .filter((p) => !p.training.deletedAt)
        .map((p) => {
          const { deletedAt: _d, ...t } = p.training;
          return { ...t, present: p.present };
        })
        .sort((a, b) => (b.startDate?.getTime() ?? 0) - (a.startDate?.getTime() ?? 0));

      const journeyRows = await this.prisma.employeeJourney.findMany({
        where: { organizationId: orgId, employeeId: employee.id, deletedAt: null, kind: 'ONBOARDING' },
        orderBy: { startDate: 'desc' },
        take: 1,
        select: { id: true },
      });
      const onboarding = journeyRows[0] ? await this.journeys.get(orgId, journeyRows[0].id) : null;

      return {
        employee: { ...profile, departmentName: department?.name ?? null },
        jobDescription: jd ? { ...jd, assignedAt: assignments[0]?.assignedAt ?? null } : null,
        competencies,
        trainings,
        onboarding: onboarding
          ? {
              id: onboarding.id,
              reference: onboarding.reference,
              status: onboarding.status,
              startDate: onboarding.startDate,
              targetDate: onboarding.targetDate,
              buddy: onboarding.buddy,
              trialDecision: onboarding.trialDecision,
              progress: onboarding.progress,
              items: onboarding.items.map((i) => ({
                id: i.id, kind: i.kind, label: i.label, dueDate: i.dueDate, state: i.state,
                trainingId: i.trainingId,
              })),
              linked: onboarding.linked,
            }
          : null,
      };
    });
  }
}

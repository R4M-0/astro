import { Injectable, NotFoundException } from '@nestjs/common';
import { NotificationsService } from '../../core/notifications/notifications.service';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class EvaluationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  /** Expected level per (employeeId, skillId) derived from the employee's assigned job description. */
  private async expectedMap(orgId: string) {
    const assignments = await this.prisma.jobAssignment.findMany({
      where: { organizationId: orgId },
      include: { jobDescription: { include: { skillRequirements: true } } },
    });
    const map = new Map<string, number>();
    for (const a of assignments) {
      for (const r of a.jobDescription.skillRequirements) {
        map.set(`${a.employeeId}:${r.skillId}`, r.requiredLevel);
      }
    }
    return map;
  }

  /** Full competency matrix: employees × skills with expected/evaluated/gap. */
  async matrix(orgId: string, departmentId?: string) {
    const [employees, skills, evaluations, expected] = await Promise.all([
      this.prisma.employee.findMany({
        where: { organizationId: orgId, deletedAt: null, ...(departmentId ? { departmentId } : {}) },
        orderBy: { lastName: 'asc' },
        select: {
          id: true,
          firstName: true,
          lastName: true,
          reference: true,
          departmentId: true,
          active: true,
          assignments: { select: { jobDescription: { select: { id: true, jobTitle: true } } } },
        },
      }),
      this.prisma.skill.findMany({
        where: { organizationId: orgId, deletedAt: null },
        orderBy: [{ type: 'asc' }, { name: 'asc' }],
      }),
      this.prisma.competencyEvaluation.findMany({
        where: { organizationId: orgId, ...(departmentId ? { employee: { departmentId } } : {}) },
      }),
      this.expectedMap(orgId),
    ]);
    return {
      employees: employees.map((e) => {
        const { assignments, ...rest } = e;
        return { ...rest, jobDescription: assignments[0]?.jobDescription ?? null };
      }),
      skills,
      evaluations,
      expected: Array.from(expected.entries()).map(([k, requiredLevel]) => {
        const [employeeId, skillId] = k.split(':');
        return { employeeId, skillId, requiredLevel };
      }),
    };
  }

  list(orgId: string, employeeId?: string, skillId?: string) {
    return this.prisma.competencyEvaluation.findMany({
      where: {
        organizationId: orgId,
        ...(employeeId ? { employeeId } : {}),
        ...(skillId ? { skillId } : {}),
      },
      include: { skill: true, employee: { select: { id: true, firstName: true, lastName: true } } },
      orderBy: { evaluatedAt: 'desc' },
    });
  }

  async upsert(orgId: string, userId: string, dto: Record<string, unknown>) {
    const employeeId = dto.employeeId as string;
    const skillId = dto.skillId as string;
    const evaluatedLevel = dto.evaluatedLevel as number;
    // both sides of the (employee, skill) key must belong to the caller's org —
    // the unique key itself has no org component.
    const [employeeOk, skillOk] = await Promise.all([
      this.prisma.employee.findFirst({ where: { id: employeeId, organizationId: orgId, deletedAt: null }, select: { id: true } }),
      this.prisma.skill.findFirst({ where: { id: skillId, organizationId: orgId, deletedAt: null }, select: { id: true } }),
    ]);
    if (!employeeOk) throw new NotFoundException('Employee not found');
    if (!skillOk) throw new NotFoundException('Skill not found');
    let expectedLevel = dto.expectedLevel as number | undefined;
    if (expectedLevel === undefined) {
      const map = await this.expectedMap(orgId);
      expectedLevel = map.get(`${employeeId}:${skillId}`);
    }
    const gap = expectedLevel != null ? evaluatedLevel - expectedLevel : 0;
    const evaluation = await this.prisma.competencyEvaluation.upsert({
      where: { employeeId_skillId: { employeeId, skillId } },
      create: {
        organizationId: orgId,
        employeeId,
        skillId,
        expectedLevel: expectedLevel ?? null,
        evaluatedLevel,
        gap,
        evaluationMethod: (dto.evaluationMethod as string) || null,
        requiredAction: (dto.requiredAction as string) || null,
        evaluatedById: userId,
        evaluatedAt: new Date(),
      },
      update: {
        expectedLevel: expectedLevel ?? null,
        evaluatedLevel,
        gap,
        evaluationMethod: (dto.evaluationMethod as string) || null,
        requiredAction: (dto.requiredAction as string) || null,
        evaluatedById: userId,
        evaluatedAt: new Date(),
      },
    });
    // Competency gap detected (under-qualified for the assigned job) → alert the
    // employee (if they're a login user) and the quality managers.
    if (gap < 0) {
      const [emp, skill, managers] = await Promise.all([
        this.prisma.employee.findUnique({
          where: { id: employeeId },
          select: { userId: true, firstName: true, lastName: true },
        }),
        this.prisma.skill.findUnique({ where: { id: skillId }, select: { name: true } }),
        this.prisma.membership.findMany({
          where: { organizationId: orgId, deletedAt: null, role: { key: { in: ['hr_manager', 'org_admin'] } } },
          select: { userId: true },
        }),
      ]);
      const recipients = new Set<string>(managers.map((m) => m.userId).filter((u) => u !== userId));
      if (emp?.userId) recipients.add(emp.userId);
      if (recipients.size) {
        await this.notifications.notify({
          organizationId: orgId,
          userIds: [...recipients],
          type: 'competency_expiring',
          title: `Écart de compétence — ${emp ? `${emp.firstName} ${emp.lastName}` : ''} / ${skill?.name ?? ''}`,
          body: `Niveau évalué ${evaluatedLevel} pour un attendu ${expectedLevel} (écart ${gap}).`,
          entityType: 'competency-evaluation', entityId: evaluation.id, link: '/hr/competency-evaluation',
        });
      }
    }
    return evaluation;
  }

  async remove(orgId: string, id: string) {
    await this.prisma.competencyEvaluation.deleteMany({ where: { id, organizationId: orgId } });
    return { deleted: true };
  }

  /** Top/flop analysis for the evaluation dashboard. */
  async dashboard(orgId: string, departmentId?: string) {
    const [evaluations, skills, employees, departments] = await Promise.all([
      this.prisma.competencyEvaluation.findMany({
        where: { organizationId: orgId, ...(departmentId ? { employee: { departmentId } } : {}) },
      }),
      this.prisma.skill.findMany({
        where: { organizationId: orgId, deletedAt: null },
        select: { id: true, name: true, type: true },
      }),
      this.prisma.employee.findMany({
        where: { organizationId: orgId, deletedAt: null, ...(departmentId ? { departmentId } : {}) },
        select: { id: true, firstName: true, lastName: true, departmentId: true },
      }),
      this.prisma.department.findMany({
        where: { site: { organizationId: orgId } },
        select: { id: true, name: true },
      }),
    ]);
    const skillName = new Map(skills.map((s) => [s.id, s.name]));
    const empById = new Map(employees.map((e) => [e.id, e]));
    const deptName = new Map(departments.map((d) => [d.id, d.name]));

    const agg = <K extends string>(keyOf: (e: (typeof evaluations)[number]) => K | null) => {
      const m = new Map<K, { sum: number; gapSum: number; count: number }>();
      for (const ev of evaluations) {
        const k = keyOf(ev);
        if (k == null) continue;
        const cur = m.get(k) ?? { sum: 0, gapSum: 0, count: 0 };
        cur.sum += ev.evaluatedLevel;
        cur.gapSum += ev.gap;
        cur.count += 1;
        m.set(k, cur);
      }
      return m;
    };

    const skillAgg = agg((e) => e.skillId as string);
    const bySkill = Array.from(skillAgg.entries())
      .map(([id, v]) => ({
        id,
        label: skillName.get(id) ?? id,
        avgLevel: Math.round((v.sum / v.count) * 10) / 10,
        avgGap: Math.round((v.gapSum / v.count) * 10) / 10,
        count: v.count,
      }))
      .sort((a, b) => b.avgLevel - a.avgLevel);

    const empAgg = agg((e) => e.employeeId as string);
    const byEmployee = Array.from(empAgg.entries())
      .map(([id, v]) => {
        const e = empById.get(id);
        return {
          id,
          label: e ? `${e.firstName} ${e.lastName}` : id,
          avgLevel: Math.round((v.sum / v.count) * 10) / 10,
          avgGap: Math.round((v.gapSum / v.count) * 10) / 10,
          count: v.count,
        };
      })
      .sort((a, b) => b.avgLevel - a.avgLevel);

    const deptAgg = agg((e) => empById.get(e.employeeId)?.departmentId ?? null);
    const byDepartment = Array.from(deptAgg.entries())
      .map(([id, v]) => ({
        id,
        label: deptName.get(id) ?? id,
        avgLevel: Math.round((v.sum / v.count) * 10) / 10,
        avgGap: Math.round((v.gapSum / v.count) * 10) / 10,
        count: v.count,
      }))
      .sort((a, b) => b.avgLevel - a.avgLevel);

    const gaps = evaluations.filter((e) => e.gap < 0).length;
    const avgGap = evaluations.length
      ? Math.round((evaluations.reduce((s, e) => s + e.gap, 0) / evaluations.length) * 10) / 10
      : 0;

    return {
      totalEvaluations: evaluations.length,
      employeesEvaluated: new Set(evaluations.map((e) => e.employeeId)).size,
      skillsEvaluated: new Set(evaluations.map((e) => e.skillId)).size,
      gapsCount: gaps,
      avgGap,
      topSkills: bySkill.slice(0, 5),
      flopSkills: [...bySkill].reverse().slice(0, 5),
      topEmployees: byEmployee.slice(0, 5),
      flopEmployees: [...byEmployee].reverse().slice(0, 5),
      topDepartments: byDepartment.slice(0, 5),
      flopDepartments: [...byDepartment].reverse().slice(0, 5),
    };
  }
}

import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { SkillQuery } from './dto/hr.dto';

@Injectable()
export class SkillsService {
  constructor(private readonly prisma: PrismaService) {}

  list(orgId: string, q: SkillQuery) {
    const where: Prisma.SkillWhereInput = {
      organizationId: orgId,
      deletedAt: null,
      ...(q.type ? { type: q.type as Prisma.SkillWhereInput['type'] } : {}),
      ...(q.search
        ? {
            OR: [
              { name: { contains: q.search, mode: 'insensitive' } },
              { description: { contains: q.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    return this.prisma.skill.findMany({
      where,
      orderBy: [{ type: 'asc' }, { name: 'asc' }],
      include: { _count: { select: { requirements: true, evaluations: true } } },
    });
  }

  /**
   * Skill detail: the job descriptions requiring it (with the required level) and the competency
   * evaluations of employees on it. Both lists are top-level reads, so the caller's record
   * visibility applies, and each is returned only when the caller may read that register.
   */
  async get(orgId: string, id: string, granted: Set<string>) {
    const skill = await this.prisma.skill.findFirst({
      where: { id, organizationId: orgId, deletedAt: null },
      include: { _count: { select: { requirements: true, evaluations: true } } },
    });
    if (!skill) throw new NotFoundException('Skill not found');

    const canJobs = granted.has('job-descriptions:read');
    const canEvals = granted.has('competency-evaluations:read') && granted.has('employees:read');

    const [jobs, evaluations] = await Promise.all([
      canJobs
        ? this.prisma.jobDescription.findMany({
            where: { organizationId: orgId, deletedAt: null, skillRequirements: { some: { skillId: id } } },
            select: {
              id: true,
              reference: true,
              version: true,
              jobTitle: true,
              status: true,
              skillRequirements: { where: { skillId: id }, select: { requiredLevel: true } },
            },
            orderBy: [{ jobTitle: 'asc' }, { reference: 'asc' }],
          })
        : null,
      canEvals
        ? this.prisma.competencyEvaluation.findMany({
            where: { organizationId: orgId, skillId: id, employee: { deletedAt: null } },
            select: {
              id: true,
              expectedLevel: true,
              evaluatedLevel: true,
              gap: true,
              evaluationMethod: true,
              requiredAction: true,
              evaluatedAt: true,
              employee: { select: { id: true, reference: true, firstName: true, lastName: true, jobTitle: true, active: true } },
            },
            orderBy: [{ gap: 'asc' }, { evaluatedAt: 'desc' }],
          })
        : null,
    ]);

    return {
      ...skill,
      jobDescriptions: jobs?.map(({ skillRequirements, ...jd }) => ({
        ...jd,
        requiredLevel: skillRequirements[0]?.requiredLevel ?? null,
      })) ?? null,
      evaluations,
    };
  }

  async assert(orgId: string, id: string) {
    const skill = await this.prisma.skill.findFirst({
      where: { id, organizationId: orgId, deletedAt: null },
    });
    if (!skill) throw new NotFoundException('Skill not found');
    return skill;
  }

  create(orgId: string, userId: string, dto: Record<string, unknown>) {
    return this.prisma.skill.create({
      data: {
        organizationId: orgId,
        name: dto.name as string,
        description: (dto.description as string) || null,
        type: (dto.type ?? 'TECHNICAL') as 'TECHNICAL',
        createdById: userId,
      },
    });
  }

  async update(orgId: string, id: string, dto: Record<string, unknown>) {
    await this.assert(orgId, id);
    return this.prisma.skill.update({
      where: { id },
      data: {
        ...(dto.name !== undefined ? { name: dto.name as string } : {}),
        ...(dto.description !== undefined ? { description: (dto.description as string) || null } : {}),
        ...(dto.type !== undefined ? { type: dto.type as 'TECHNICAL' } : {}),
      },
    });
  }

  async remove(orgId: string, id: string) {
    await this.assert(orgId, id);
    await this.prisma.skill.update({ where: { id }, data: { deletedAt: new Date() } });
    return { deleted: true };
  }
}

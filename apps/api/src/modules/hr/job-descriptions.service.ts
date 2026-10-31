import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ActivityService } from '../../core/activity/activity.service';
import { paginate, PaginationQuery } from '../../common/dto/pagination.dto';
import { PrismaService } from '../../prisma/prisma.service';
import { assertInOrg } from '../../common/assert-in-org';
import { JobDescriptionQuery } from './dto/hr.dto';

interface ActivityInput {
  description: string;
  frequency?: string;
}
interface SkillReqInput {
  skillId: string;
  requiredLevel: number;
}

@Injectable()
export class JobDescriptionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly activity: ActivityService,
  ) {}

  async list(orgId: string, q: JobDescriptionQuery) {
    const where: Prisma.JobDescriptionWhereInput = {
      organizationId: orgId,
      deletedAt: null,
      ...(q.departmentId ? { departmentId: q.departmentId } : {}),
      ...(q.status ? { status: q.status } : {}),
      ...(q.search
        ? {
            OR: [
              { jobTitle: { contains: q.search, mode: 'insensitive' } },
              { reference: { contains: q.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.jobDescription.findMany({
        where,
        orderBy: { updatedAt: 'desc' },
        skip: q.skip,
        take: q.pageSize,
        include: {
          _count: {
            select: { activities: true, skillRequirements: true, assignments: true },
          },
        },
      }),
      this.prisma.jobDescription.count({ where }),
    ]);
    const decorated = rows.map((r) => {
      const { _count, ...rest } = r;
      return {
        ...rest,
        activityCount: _count.activities,
        skillCount: _count.skillRequirements,
        assignedCount: _count.assignments,
      };
    });
    return paginate(decorated, total, q as unknown as PaginationQuery);
  }

  async assert(orgId: string, id: string) {
    const jd = await this.prisma.jobDescription.findFirst({
      where: { id, organizationId: orgId, deletedAt: null },
    });
    if (!jd) throw new NotFoundException('Job description not found');
    return jd;
  }

  get(orgId: string, id: string) {
    return this.prisma.jobDescription
      .findFirst({
        where: { id, organizationId: orgId, deletedAt: null },
        include: {
          activities: { orderBy: { sortOrder: 'asc' } },
          skillRequirements: { include: { skill: true } },
          assignments: {
            include: { employee: { select: { id: true, firstName: true, lastName: true, reference: true } } },
          },
        },
      })
      .then((jd) => {
        if (!jd) throw new NotFoundException('Job description not found');
        return jd;
      });
  }

  private mapData(dto: Record<string, unknown>): Prisma.JobDescriptionUncheckedUpdateInput {
    const data: Prisma.JobDescriptionUncheckedUpdateInput = {};
    const strFields = [
      'reference',
      'version',
      'jobTitle',
      'departmentId',
      'managerId',
      'replacementId',
      'mainMission',
      'hierarchicalLink',
      'functionalLink',
      'jobPurpose',
      'authority',
      'experienceDomain',
      'status',
    ] as const;
    for (const f of strFields) {
      if (dto[f] !== undefined) {
        (data as Record<string, unknown>)[f] =
          f === 'reference' || f === 'version' || f === 'jobTitle' || f === 'status'
            ? (dto[f] as string)
            : (dto[f] as string) || null;
      }
    }
    if (dto.applicationDate !== undefined)
      data.applicationDate = dto.applicationDate ? new Date(dto.applicationDate as string) : null;
    if (dto.minExperienceMonths !== undefined)
      data.minExperienceMonths =
        dto.minExperienceMonths === null ? null : (dto.minExperienceMonths as number);
    if (dto.requiredTraining !== undefined)
      data.requiredTraining = dto.requiredTraining as Prisma.InputJsonValue;
    if (dto.qualityAwareness !== undefined)
      data.qualityAwareness = dto.qualityAwareness as Prisma.InputJsonValue;
    return data;
  }

  private assertUniqueSkills(reqs?: SkillReqInput[]) {
    if (!reqs) return;
    const ids = reqs.map((r) => r.skillId);
    if (new Set(ids).size !== ids.length)
      throw new BadRequestException('Une compétence ne peut apparaître qu\'une seule fois');
  }

  /** Every referenced skill must belong to the org (ids come from the client). */
  private async assertSkillsInOrg(orgId: string, reqs: SkillReqInput[] | undefined) {
    const ids = [...new Set((reqs ?? []).map((r) => r.skillId))];
    if (!ids.length) return;
    const count = await this.prisma.skill.count({
      where: { id: { in: ids }, organizationId: orgId, deletedAt: null },
    });
    if (count !== ids.length) throw new BadRequestException('Unknown skill in requirements');
  }


  /** The department must belong to the org (ids come from the client). */
  private async assertDepartment(orgId: string, departmentId: unknown) {
    if (!departmentId) return;
    const found = await this.prisma.department.count({
      where: { id: departmentId as string, deletedAt: null, site: { organizationId: orgId } },
    });
    if (!found) throw new BadRequestException('Département inconnu');
  }

  async create(orgId: string, userId: string, dto: Record<string, unknown>) {
    this.assertUniqueSkills(dto.skillRequirements as SkillReqInput[] | undefined);
    await this.assertSkillsInOrg(orgId, dto.skillRequirements as SkillReqInput[] | undefined);
    await this.assertDepartment(orgId, dto.departmentId);
    await assertInOrg(this.prisma, orgId, 'employee', [dto.managerId as string | undefined, dto.replacementId as string | undefined]);
    const base = this.mapData(dto) as Prisma.JobDescriptionUncheckedCreateInput;
    const activities = (dto.activities as ActivityInput[] | undefined) ?? [];
    const reqs = (dto.skillRequirements as SkillReqInput[] | undefined) ?? [];
    const jd = await this.prisma.jobDescription.create({
      data: {
        organizationId: orgId,
        reference: dto.reference as string,
        version: dto.version as string,
        jobTitle: dto.jobTitle as string,
        applicationDate: dto.applicationDate ? new Date(dto.applicationDate as string) : null,
        departmentId: (dto.departmentId as string) || null,
        managerId: (dto.managerId as string) || null,
        replacementId: (dto.replacementId as string) || null,
        mainMission: (dto.mainMission as string) || null,
        hierarchicalLink: (dto.hierarchicalLink as string) || null,
        functionalLink: (dto.functionalLink as string) || null,
        jobPurpose: (dto.jobPurpose as string) || null,
        authority: (dto.authority as string) || null,
        minExperienceMonths: (dto.minExperienceMonths as number) ?? null,
        experienceDomain: (dto.experienceDomain as string) || null,
        requiredTraining: (base.requiredTraining as Prisma.InputJsonValue) ?? [],
        qualityAwareness: (base.qualityAwareness as Prisma.InputJsonValue) ?? {},
        status: (dto.status as string) ?? 'DRAFT',
        createdById: userId,
        activities: {
          create: activities.map((a, i) => ({
            description: a.description,
            frequency: a.frequency || null,
            sortOrder: i,
          })),
        },
        skillRequirements: {
          create: reqs.map((r) => ({ skillId: r.skillId, requiredLevel: r.requiredLevel })),
        },
      },
    });
    this.activity.record({
      organizationId: orgId,
      entityType: 'job-description',
      entityId: jd.id,
      actorId: userId,
      verb: 'created',
      data: { reference: jd.reference, jobTitle: jd.jobTitle },
    });
    return this.get(orgId, jd.id);
  }

  async update(orgId: string, userId: string, id: string, dto: Record<string, unknown>) {
    await this.assert(orgId, id);
    this.assertUniqueSkills(dto.skillRequirements as SkillReqInput[] | undefined);
    await this.assertDepartment(orgId, dto.departmentId);
    await assertInOrg(this.prisma, orgId, 'employee', [dto.managerId as string | undefined, dto.replacementId as string | undefined]);
    const data = this.mapData(dto);
    data.updatedById = userId;

    const ops: Prisma.PrismaPromise<unknown>[] = [
      this.prisma.jobDescription.update({ where: { id }, data }),
    ];

    if (dto.activities !== undefined) {
      const activities = (dto.activities as ActivityInput[]) ?? [];
      ops.push(this.prisma.jobActivity.deleteMany({ where: { jobDescriptionId: id } }));
      if (activities.length)
        ops.push(
          this.prisma.jobActivity.createMany({
            data: activities.map((a, i) => ({
              jobDescriptionId: id,
              description: a.description,
              frequency: a.frequency || null,
              sortOrder: i,
            })),
          }),
        );
    }
    if (dto.skillRequirements !== undefined) {
      const reqs = (dto.skillRequirements as SkillReqInput[]) ?? [];
      await this.assertSkillsInOrg(orgId, reqs);
      ops.push(this.prisma.jobSkillRequirement.deleteMany({ where: { jobDescriptionId: id } }));
      if (reqs.length)
        ops.push(
          this.prisma.jobSkillRequirement.createMany({
            data: reqs.map((r) => ({
              jobDescriptionId: id,
              skillId: r.skillId,
              requiredLevel: r.requiredLevel,
            })),
          }),
        );
    }
    await this.prisma.$transaction(ops);
    this.activity.record({
      organizationId: orgId,
      entityType: 'job-description',
      entityId: id,
      actorId: userId,
      verb: 'updated',
    });
    return this.get(orgId, id);
  }

  async remove(orgId: string, userId: string, id: string) {
    await this.assert(orgId, id);
    await this.prisma.jobDescription.update({ where: { id }, data: { deletedAt: new Date() } });
    this.activity.record({
      organizationId: orgId,
      entityType: 'job-description',
      entityId: id,
      actorId: userId,
      verb: 'deleted',
    });
    return { deleted: true };
  }
}

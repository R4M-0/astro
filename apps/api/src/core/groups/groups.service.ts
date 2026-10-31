import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { assertMembers } from '../../common/assert-members';
import { PrismaService } from '../../prisma/prisma.service';

export interface GroupInput {
  name?: string;
  description?: string | null;
  color?: string | null;
  departmentIds?: string[];
}

/**
 * User groups: named sets of members. A record shared with a group is visible to all its members, and
 * the group's departments (processes) are added to every member's visible departments — resolved per
 * request by the department-scope layer, so changes here take effect immediately.
 */
@Injectable()
export class GroupsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(orgId: string) {
    const groups = await this.prisma.userGroup.findMany({
      where: { organizationId: orgId, deletedAt: null },
      orderBy: { name: 'asc' },
      include: { members: { select: { userId: true } } },
    });
    const userIds = [...new Set(groups.flatMap((g) => g.members.map((m) => m.userId)))];
    const users = userIds.length
      ? await this.prisma.user.findMany({
          where: { id: { in: userIds } },
          select: { id: true, firstName: true, lastName: true, email: true },
        })
      : [];
    const byId = new Map(users.map((u) => [u.id, u]));
    return groups.map((g) => {
      const members = g.members
        .map((m) => byId.get(m.userId))
        .filter((u): u is NonNullable<typeof u> => !!u)
        .map((u) => ({ userId: u.id, firstName: u.firstName, lastName: u.lastName, email: u.email }))
        .sort((a, b) => `${a.firstName} ${a.lastName}`.localeCompare(`${b.firstName} ${b.lastName}`));
      return {
        id: g.id,
        name: g.name,
        description: g.description,
        color: g.color,
        departmentIds: g.departmentIds,
        createdAt: g.createdAt,
        updatedAt: g.updatedAt,
        members,
        memberCount: members.length,
      };
    });
  }

  async directory(orgId: string) {
    const groups = await this.prisma.userGroup.findMany({
      where: { organizationId: orgId, deletedAt: null },
      orderBy: { name: 'asc' },
      select: { id: true, name: true, color: true, _count: { select: { members: true } } },
    });
    return groups.map((g) => ({ id: g.id, name: g.name, color: g.color, memberCount: g._count.members }));
  }

  async create(orgId: string, dto: GroupInput) {
    const name = dto.name?.trim();
    if (!name) throw new BadRequestException('Name is required');
    await this.assertUniqueName(orgId, name);
    const departmentIds = await this.validDepartments(orgId, dto.departmentIds);
    const g = await this.prisma.userGroup.create({
      data: {
        organizationId: orgId,
        name,
        description: dto.description?.trim() || null,
        color: dto.color || null,
        departmentIds,
      },
    });
    return this.one(orgId, g.id);
  }

  async update(orgId: string, id: string, dto: GroupInput) {
    await this.find(orgId, id);
    const data: Record<string, unknown> = {};
    if (dto.name !== undefined) {
      const name = dto.name.trim();
      if (!name) throw new BadRequestException('Name is required');
      await this.assertUniqueName(orgId, name, id);
      data.name = name;
    }
    if (dto.description !== undefined) data.description = dto.description?.trim() || null;
    if (dto.color !== undefined) data.color = dto.color || null;
    if (dto.departmentIds !== undefined) data.departmentIds = await this.validDepartments(orgId, dto.departmentIds);
    await this.prisma.userGroup.update({ where: { id }, data });
    return this.one(orgId, id);
  }

  async remove(orgId: string, id: string) {
    await this.find(orgId, id);
    await this.prisma.recordShare.deleteMany({ where: { organizationId: orgId, groupId: id } });
    await this.prisma.userGroup.update({ where: { id }, data: { deletedAt: new Date() } });
    return { ok: true };
  }

  async setMembers(orgId: string, id: string, userIds: string[]) {
    await this.find(orgId, id);
    const ids = [...new Set((userIds ?? []).filter((u) => typeof u === 'string' && u.length > 0))];
    await assertMembers(this.prisma, orgId, ids, 'member');
    await this.prisma.$transaction([
      this.prisma.userGroupMember.deleteMany({ where: { groupId: id, userId: { notIn: ids } } }),
      this.prisma.userGroupMember.createMany({
        data: ids.map((userId) => ({ groupId: id, userId })),
        skipDuplicates: true,
      }),
    ]);
    return this.one(orgId, id);
  }

  private async one(orgId: string, id: string) {
    const all = await this.list(orgId);
    const g = all.find((x) => x.id === id);
    if (!g) throw new NotFoundException('Group not found');
    return g;
  }

  private async find(orgId: string, id: string) {
    const g = await this.prisma.userGroup.findFirst({ where: { id, organizationId: orgId, deletedAt: null } });
    if (!g) throw new NotFoundException('Group not found');
    return g;
  }

  private async assertUniqueName(orgId: string, name: string, exceptId?: string) {
    const clash = await this.prisma.userGroup.findFirst({
      where: {
        organizationId: orgId,
        deletedAt: null,
        name: { equals: name, mode: 'insensitive' },
        ...(exceptId ? { id: { not: exceptId } } : {}),
      },
      select: { id: true },
    });
    if (clash) throw new BadRequestException('A group with this name already exists');
  }

  private async validDepartments(orgId: string, ids: string[] | undefined): Promise<string[]> {
    const unique = [...new Set((ids ?? []).filter((d) => typeof d === 'string' && d.length > 0))];
    if (!unique.length) return [];
    const count = await this.prisma.department.count({
      where: { id: { in: unique }, deletedAt: null, site: { organizationId: orgId } },
    });
    if (count !== unique.length) throw new BadRequestException('Unknown department for this organization');
    return unique;
  }
}

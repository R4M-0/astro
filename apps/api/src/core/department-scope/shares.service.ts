import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { assertMembers } from '../../common/assert-members';
import { PrismaService } from '../../prisma/prisma.service';
import { MODEL_RESOURCE } from '../history/history-map';
import { entityTypeDef } from '../entities/entity-registry';
import { EntityResolverService } from '../entities/entity-resolver.service';
import { NotificationsService } from '../notifications/notifications.service';
import { SHAREABLE_MODELS } from './department-scope';

/** Web route of a record, for the « shared with you » notification (null = no detail page). */
const ROUTES: Record<string, (id: string) => string> = {
  Employee: (id) => `/hr/employees/${id}`,
  EmployeeJourney: (id) => `/hr/journeys/${id}`,
  JobDescription: (id) => `/hr/job-descriptions/${id}`,
  HrTraining: (id) => `/hr/trainings/${id}`,
};

/** Fields tried, in order, to name a record in the notification. */
const LABEL_FIELDS = ['reference', 'code', 'title', 'name', 'hazard', 'jobTitle', 'lastName'];

/**
 * Per-record invitations: a record of a department-scoped register can be shared with named members
 * of other departments (RecordShare). Reading the list needs `<resource>:read`, changing it
 * `<resource>:update` — and in both cases the caller must be able to see the record themselves.
 */
@Injectable()
export class SharesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly entities: EntityResolverService,
  ) {}

  private resourceOf(entityType: string): string {
    if (!SHAREABLE_MODELS.has(entityType) || !entityTypeDef(entityType)) throw new BadRequestException('Ce type d’élément ne se partage pas');
    return MODEL_RESOURCE[entityType];
  }

  /**
   * The record as the caller sees it — org-checked (directly or through its parent) and filtered by the
   * visibility policy; 404 when it is outside their organization or visibility.
   */
  private async record(orgId: string, granted: Set<string>, entityType: string, entityId: string): Promise<Record<string, unknown>> {
    const { row } = await this.entities.resolve({ orgId, granted }, entityType, entityId, 'read');
    return row;
  }

  private assertGranted(granted: Set<string>, entityType: string, action: 'read' | 'update') {
    const key = `${this.resourceOf(entityType)}:${action}`;
    if (!granted.has(key)) throw new ForbiddenException(`Missing permissions: ${key}`);
  }

  async list(orgId: string, granted: Set<string>, entityType: string, entityId: string) {
    this.assertGranted(granted, entityType, 'read');
    const rec = await this.record(orgId, granted, entityType, entityId);
    const shares = await this.prisma.recordShare.findMany({
      where: { organizationId: orgId, entityType, entityId },
      orderBy: { createdAt: 'asc' },
    });
    const userIds = [...new Set(shares.flatMap((s) => [s.userId, s.grantedById]).filter(Boolean) as string[])];
    const groupIds = shares.map((s) => s.groupId).filter(Boolean) as string[];
    const [users, groups] = await Promise.all([
      this.prisma.user.findMany({
        where: { id: { in: userIds } },
        select: { id: true, firstName: true, lastName: true, email: true, avatarUrl: true },
      }),
      groupIds.length
        ? this.prisma.userGroup.findMany({
            where: { id: { in: groupIds }, organizationId: orgId },
            select: { id: true, name: true, color: true, _count: { select: { members: true } } },
          })
        : Promise.resolve([]),
    ]);
    const byId = new Map(users.map((u) => [u.id, u]));
    const groupById = new Map(groups.map((g) => [g.id, g]));
    const departmentId = (rec.departmentId as string | null | undefined) ?? null;
    const department = departmentId
      ? await this.prisma.department.findFirst({ where: { id: departmentId }, select: { id: true, name: true } })
      : null;
    return {
      department,
      shares: shares
        .filter((s) => s.userId)
        .map((s) => ({
          userId: s.userId as string,
          user: byId.get(s.userId as string) ?? null,
          grantedBy: s.grantedById ? (byId.get(s.grantedById) ?? null) : null,
          createdAt: s.createdAt,
        })),
      groupShares: shares
        .filter((s) => s.groupId && groupById.has(s.groupId))
        .map((s) => {
          const g = groupById.get(s.groupId as string)!;
          return {
            groupId: g.id,
            group: { id: g.id, name: g.name, color: g.color, memberCount: g._count.members },
            grantedBy: s.grantedById ? (byId.get(s.grantedById) ?? null) : null,
            createdAt: s.createdAt,
          };
        }),
    };
  }

  async add(
    orgId: string,
    actorId: string,
    granted: Set<string>,
    entityType: string,
    entityId: string,
    userIds: string[] = [],
    groupIds: string[] = [],
  ) {
    this.assertGranted(granted, entityType, 'update');
    const rec = await this.record(orgId, granted, entityType, entityId);
    const ids = [...new Set(userIds)].filter((id) => id && id !== actorId);
    const gids = [...new Set(groupIds)].filter(Boolean);
    await assertMembers(this.prisma, orgId, ids);
    const groups = gids.length
      ? await this.prisma.userGroup.findMany({
          where: { id: { in: gids }, organizationId: orgId, deletedAt: null },
          select: { id: true, members: { select: { userId: true } } },
        })
      : [];
    if (groups.length !== gids.length) throw new BadRequestException('Groupe inconnu');

    const existing = await this.prisma.recordShare.findMany({
      where: { organizationId: orgId, entityType, entityId, OR: [{ userId: { in: ids } }, { groupId: { in: gids } }] },
      select: { userId: true, groupId: true },
    });
    const freshUsers = ids.filter((id) => !existing.some((e) => e.userId === id));
    const freshGroups = groups.filter((g) => !existing.some((e) => e.groupId === g.id));
    if (freshUsers.length || freshGroups.length) {
      await this.prisma.recordShare.createMany({
        data: [
          ...freshUsers.map((userId) => ({
            organizationId: orgId, entityType, entityId, userId, shareKey: `u:${userId}`, grantedById: actorId,
          })),
          ...freshGroups.map((g) => ({
            organizationId: orgId, entityType, entityId, groupId: g.id, shareKey: `g:${g.id}`, grantedById: actorId,
          })),
        ],
        skipDuplicates: true,
      });
      const label = LABEL_FIELDS.map((f) => rec[f]).find((v) => typeof v === 'string' && v) as string | undefined;
      const notified = [...new Set([...freshUsers, ...freshGroups.flatMap((g) => g.members.map((m) => m.userId))])].filter(
        (id) => id !== actorId,
      );
      await this.notifications.notify({
        organizationId: orgId,
        userIds: notified,
        type: 'record_shared',
        title: `Un élément a été partagé avec vous${label ? ` : ${label}` : ''}`,
        entityType,
        entityId,
        link: ROUTES[entityType]?.(entityId),
      });
    }
    return this.list(orgId, granted, entityType, entityId);
  }

  async remove(orgId: string, granted: Set<string>, entityType: string, entityId: string, userId: string) {
    this.assertGranted(granted, entityType, 'update');
    await this.record(orgId, granted, entityType, entityId);
    await this.prisma.recordShare.deleteMany({ where: { organizationId: orgId, entityType, entityId, userId } });
    return this.list(orgId, granted, entityType, entityId);
  }

  async removeGroup(orgId: string, granted: Set<string>, entityType: string, entityId: string, groupId: string) {
    this.assertGranted(granted, entityType, 'update');
    await this.record(orgId, granted, entityType, entityId);
    await this.prisma.recordShare.deleteMany({ where: { organizationId: orgId, entityType, entityId, groupId } });
    return this.list(orgId, granted, entityType, entityId);
  }
}

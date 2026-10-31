import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { lockedAddonResources } from '@astro/shared';
import { licensedAddons } from '../license/license.service';
import { assertInOrg } from '../../common/assert-in-org';
import { paginate, PaginationQuery } from '../../common/dto/pagination.dto';
import { InvitationsService } from '../auth/invitations.service';
import { publicOrgSettings } from '../organizations/org-settings';
import { PrismaService } from '../../prisma/prisma.service';
import { SubscriptionsService } from '../../modules/platform/subscriptions.service';
import { SELF_HOSTED } from '../license/deployment-mode';

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly subs: SubscriptionsService,
    private readonly invitations: InvitationsService,
  ) {}

  async getMe(userId: string, orgId: string | undefined) {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        avatarUrl: true,
        locale: true,
        emailVerifiedAt: true,
        twoFactorEnabled: true,
        isSuperAdmin: true,
        memberships: {
          // pending invitations grant nothing until accepted
          where: { deletedAt: null, acceptedAt: { not: null } },
          select: {
            id: true,
            organizationId: true,
            jobTitle: true,
            isDefault: true,
            departmentId: true,
            extraDepartmentIds: true,
            organization: { select: { id: true, name: true, slug: true, logoUrl: true, settings: true } },
            role: { select: { id: true, key: true, name: true, departmentScoped: true } },
          },
        },
      },
    });
    // members only see the public organization settings
    const memberships = user.memberships.map((m) => ({
      ...m,
      organization: { ...m.organization, settings: publicOrgSettings(m.organization.settings) },
    }));
    return { ...user, isSuperAdmin: !SELF_HOSTED && user.isSuperAdmin, memberships, activeOrganizationId: orgId ?? null };
  }

  updateMe(userId: string, data: { firstName?: string; lastName?: string; locale?: string }) {
    return this.prisma.user.update({
      where: { id: userId },
      data,
      select: { id: true, firstName: true, lastName: true, locale: true },
    });
  }

  async getMyPermissions(userId: string, orgId: string) {
    const membership = await this.prisma.membership.findFirst({
      where: { userId, organizationId: orgId, deletedAt: null, acceptedAt: { not: null } },
      include: {
        role: { include: { permissions: { include: { permission: true } } } },
        organization: { select: { subscription: { select: { addons: true } } } },
      },
    });
    if (!membership) return { role: null, permissions: [], addons: [] };
    const addons = licensedAddons(membership.organization.subscription?.addons);
    const locked = lockedAddonResources(addons);
    return {
      role: { id: membership.role.id, key: membership.role.key, name: membership.role.name },
      permissions: membership.role.permissions
        .filter((rp) => !locked.has(rp.permission.resource))
        .map((rp) => `${rp.permission.resource}:${rp.permission.action}`),
      /** paid add-on modules the organization subscribes to */
      addons,
    };
  }

  async directory(orgId: string) {
    const memberships = await this.prisma.membership.findMany({
      where: { organizationId: orgId, deletedAt: null, isActive: true, acceptedAt: { not: null } },
      select: { user: { select: { id: true, firstName: true, lastName: true, email: true, avatarUrl: true } } },
    });
    const data = memberships
      .filter((m) => m.user)
      .sort((a, b) => `${a.user.firstName} ${a.user.lastName}`.localeCompare(`${b.user.firstName} ${b.user.lastName}`));
    return { data };
  }

  async listMembers(orgId: string, q: PaginationQuery) {
    const where = {
      organizationId: orgId,
      deletedAt: null,
      ...(q.search
        ? {
            user: {
              OR: [
                { firstName: { contains: q.search, mode: 'insensitive' as const } },
                { lastName: { contains: q.search, mode: 'insensitive' as const } },
                { email: { contains: q.search, mode: 'insensitive' as const } },
              ],
            },
          }
        : {}),
    };
    const [data, total] = await Promise.all([
      this.prisma.membership.findMany({
        where,
        skip: q.skip,
        take: q.pageSize,
        orderBy: { createdAt: 'asc' },
        include: {
          user: {
            select: {
              id: true,
              email: true,
              firstName: true,
              lastName: true,
              avatarUrl: true,
              lastLoginAt: true,
              emailVerifiedAt: true,
              twoFactorEnabled: true,
            },
          },
          role: { select: { id: true, key: true, name: true, departmentScoped: true } },
        },
      }),
      this.prisma.membership.count({ where }),
    ]);
    return paginate(data, total, q);
  }

  async inviteMember(
    orgId: string,
    dto: {
      email: string;
      firstName: string;
      lastName: string;
      roleId: string;
      siteId?: string;
      jobTitle?: string;
      departmentId?: string;
    },
  ) {
    await this.assertDepartments(orgId, [dto.departmentId]);
    await assertInOrg(this.prisma, orgId, 'site', dto.siteId);
    const role = await this.prisma.role.findFirst({
      where: { id: dto.roleId, organizationId: orgId },
    });
    if (!role) throw new BadRequestException('Unknown role for this organization');

    const existingUser = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (existingUser) {
      const existing = await this.prisma.membership.findUnique({
        where: { organizationId_userId: { organizationId: orgId, userId: existingUser.id } },
      });
      if (existing && !existing.deletedAt) {
        throw new BadRequestException('User is already a member of this organization');
      }
    }

    // enforce the organization's seat quota (server-side, before consuming a seat)
    await this.subs.assertSeatAvailable(orgId);

    // never attach an account silently: the membership stays pending until the invitee uses the
    // link mailed to the invited address (an unverified pre-registration is neutralised first)
    const { user, kind } = await this.invitations.prepareInvitee(dto);
    const pending = {
      roleId: dto.roleId,
      siteId: dto.siteId,
      jobTitle: dto.jobTitle,
      departmentId: dto.departmentId,
      invitedAt: new Date(),
      acceptedAt: null,
      isActive: true,
      deactivatedAt: null,
      isDefault: false,
    };
    const existing = await this.prisma.membership.findUnique({
      where: { organizationId_userId: { organizationId: orgId, userId: user.id } },
    });
    const membership = existing
      ? await this.prisma.membership.update({ where: { id: existing.id }, data: { ...pending, deletedAt: null } })
      : await this.prisma.membership.create({ data: { organizationId: orgId, userId: user.id, ...pending } });

    await this.invitations.sendInvitation(membership.id, kind);
    return membership;
  }

  async updateMembership(
    orgId: string,
    membershipId: string,
    input: {
      roleId?: string;
      siteId?: string;
      jobTitle?: string;
      departmentId?: string | null;
      extraDepartmentIds?: string[];
      firstName?: string;
      lastName?: string;
    },
  ) {
    const { firstName, lastName, ...rest } = input;
    let data = rest;
    const membership = await this.prisma.membership.findFirst({
      where: { id: membershipId, organizationId: orgId },
    });
    if (!membership) throw new NotFoundException('Membership not found');
    if (data.departmentId === '') data = { ...data, departmentId: null };
    if (data.extraDepartmentIds) {
      const main = data.departmentId !== undefined ? data.departmentId : membership.departmentId;
      data = { ...data, extraDepartmentIds: [...new Set(data.extraDepartmentIds)].filter((d) => d && d !== main) };
    }
    await this.assertDepartments(orgId, [data.departmentId, ...(data.extraDepartmentIds ?? [])]);
    await assertInOrg(this.prisma, orgId, 'site', data.siteId);
    if (data.roleId) {
      const role = await this.prisma.role.findFirst({
        where: { id: data.roleId, organizationId: orgId },
      });
      if (!role) throw new BadRequestException('Unknown role for this organization');
      if (role.id !== membership.roleId) await this.assertNotLastAdmin(orgId, membership.id);
    }
    if (firstName !== undefined || lastName !== undefined) {
      await this.assertSoleOrganization(membership.userId, orgId);
      const names: { firstName?: string; lastName?: string } = {};
      if (firstName !== undefined) {
        if (!firstName.trim()) throw new BadRequestException('First name is required');
        names.firstName = firstName.trim();
      }
      if (lastName !== undefined) {
        if (!lastName.trim()) throw new BadRequestException('Last name is required');
        names.lastName = lastName.trim();
      }
      await this.prisma.user.update({ where: { id: membership.userId }, data: names });
    }
    return this.prisma.membership.update({ where: { id: membershipId }, data });
  }

  /**
   * Account-level changes (name, 2FA) made by an org admin are allowed only when this org is the
   * user's only organization; otherwise one tenant's admin would act on another tenant's user (M-1).
   */
  private async assertSoleOrganization(userId: string, orgId: string) {
    const others = await this.prisma.membership.count({
      where: { userId, deletedAt: null, organizationId: { not: orgId } },
    });
    if (others > 0) {
      throw new ConflictException(
        'This person also belongs to other organizations: they must change it from their own settings (or contact Astro support).',
      );
    }
  }

  /** Every given department must exist in one of the organization's sites (400 otherwise). */
  private async assertDepartments(orgId: string, ids: (string | null | undefined)[]) {
    const unique = [...new Set(ids.filter((id): id is string => !!id))];
    if (!unique.length) return;
    const count = await this.prisma.department.count({
      where: { id: { in: unique }, deletedAt: null, site: { organizationId: orgId, deletedAt: null } },
    });
    if (count !== unique.length) throw new BadRequestException('Unknown department for this organization');
  }

  async removeMembership(orgId: string, membershipId: string) {
    const membership = await this.prisma.membership.findFirst({
      where: { id: membershipId, organizationId: orgId },
    });
    if (!membership) throw new NotFoundException('Membership not found');
    await this.assertNotLastAdmin(orgId, membership.id);
    await this.prisma.membership.update({
      where: { id: membershipId },
      data: { deletedAt: new Date() },
    });
    return { removed: true };
  }

  /** An organization must always keep at least one active org_admin. */
  private async assertNotLastAdmin(orgId: string, membershipId: string) {
    const admins = await this.prisma.membership.count({
      where: {
        organizationId: orgId,
        deletedAt: null,
        isActive: true,
        role: { key: 'org_admin' },
        id: { not: membershipId },
      },
    });
    const target = await this.prisma.membership.findFirst({
      where: { id: membershipId, role: { key: 'org_admin' } },
      select: { id: true },
    });
    if (target && admins === 0) {
      throw new BadRequestException('Cannot remove or demote the last administrator of the organization');
    }
  }
}

import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { lockedAddonResources } from '@astro/shared';
import { licensedAddons } from '../license/license.service';
import { escapeHtml } from '../../common/html';
import { InvitationsService } from '../auth/invitations.service';
import { PrismaService } from '../../prisma/prisma.service';
import { SubscriptionsService } from '../../modules/platform/subscriptions.service';
import { MailService } from '../mail/mail.service';
import { NotificationsGateway } from '../notifications/notifications.gateway';
import { getHistoryContext, runWithHistoryContext, type HistoryContext } from '../history/history-context';
import { unscoped, type DepartmentAccess } from '../department-scope/department-scope';
import { REGISTERS, resolvePolicy } from '../department-scope/registers';


/** Models that carry a `deletedAt` column (soft-delete aware counts). */
const SOFT_DELETE_MODELS = new Set(
  Prisma.dmmf.datamodel.models.filter((m) => m.fields.some((f) => f.name === 'deletedAt')).map((m) => m.name),
);
const HAS_ORG_MODELS = new Set(
  Prisma.dmmf.datamodel.models.filter((m) => m.fields.some((f) => f.name === 'organizationId')).map((m) => m.name),
);

export interface BulkMembersInput {
  membershipIds: string[];
  roleId?: string;
  departmentId?: string | null;
  addExtraDepartmentIds?: string[];
  removeExtraDepartmentIds?: string[];
  addGroupIds?: string[];
  removeGroupIds?: string[];
  isActive?: boolean;
}

/**
 * Administrative member operations (Admin → Membres): activation, 2FA reset, invitation resend,
 * bulk edits and the « Voir comme » effective-access report.
 */
@Injectable()
export class MemberAdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
    private readonly config: ConfigService,
    private readonly subs: SubscriptionsService,
    private readonly gateway: NotificationsGateway,
    private readonly invitations: InvitationsService,
  ) {}

  private async getMembership(orgId: string, membershipId: string) {
    const m = await this.prisma.membership.findFirst({
      where: { id: membershipId, organizationId: orgId, deletedAt: null },
      include: {
        user: { select: { id: true, email: true, firstName: true, lastName: true, twoFactorEnabled: true, locale: true } },
        role: { select: { id: true, key: true, name: true, departmentScoped: true } },
        organization: { select: { id: true, name: true, settings: true } },
      },
    });
    if (!m) throw new NotFoundException('Membership not found');
    return m;
  }

  /**
   * An organization must keep at least one active org_admin: `losing` = memberships that would stop
   * being active admins after the operation.
   */
  private async assertAdminsRemain(orgId: string, losing: string[]) {
    if (!losing.length) return;
    const affectedAdmins = await this.prisma.membership.count({
      where: { id: { in: losing }, organizationId: orgId, deletedAt: null, isActive: true, role: { key: 'org_admin' } },
    });
    if (!affectedAdmins) return;
    const remaining = await this.prisma.membership.count({
      where: { organizationId: orgId, deletedAt: null, isActive: true, role: { key: 'org_admin' }, id: { notIn: losing } },
    });
    if (remaining === 0) {
      throw new BadRequestException('Cannot remove or demote the last administrator of the organization');
    }
  }

  /** Revokes the user's sessions unless they still have another active membership elsewhere. */
  private async revokeSessionsIfNoOtherMembership(userId: string, exceptMembershipId: string) {
    const other = await this.prisma.membership.count({
      where: { userId, deletedAt: null, isActive: true, id: { not: exceptMembershipId } },
    });
    if (other > 0) return 0;
    const { count } = await this.prisma.session.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    this.gateway.disconnectUser(userId);
    return count;
  }

  // ── activation ──────────────────────────────────────────────────────────────
  async setStatus(orgId: string, actorId: string, membershipId: string, isActive: boolean) {
    const m = await this.getMembership(orgId, membershipId);
    if (m.isActive === isActive) return { id: m.id, isActive: m.isActive, deactivatedAt: m.deactivatedAt };
    if (!isActive) {
      if (m.userId === actorId) throw new BadRequestException('You cannot deactivate your own account');
      await this.assertAdminsRemain(orgId, [m.id]);
      const updated = await this.prisma.membership.update({
        where: { id: m.id },
        data: { isActive: false, deactivatedAt: new Date() },
        select: { id: true, isActive: true, deactivatedAt: true },
      });
      await this.revokeSessionsIfNoOtherMembership(m.userId, m.id);
      return updated;
    }
    await this.subs.assertSeatAvailable(orgId);
    return this.prisma.membership.update({
      where: { id: m.id },
      data: { isActive: true, deactivatedAt: null },
      select: { id: true, isActive: true, deactivatedAt: true },
    });
  }

  // ── 2FA reset ───────────────────────────────────────────────────────────────
  /**
   * 2FA is account-level: an org admin may reset it only when this org is the user's only
   * organization (M-1); otherwise the user resets it themselves or Astro support does
   * (`POST /platform/users/:id/reset-2fa`).
   */
  async reset2fa(orgId: string, membershipId: string) {
    const m = await this.getMembership(orgId, membershipId);
    const others = await this.prisma.membership.count({
      where: { userId: m.userId, deletedAt: null, organizationId: { not: orgId } },
    });
    if (others > 0) {
      throw new ConflictException(
        'This person also belongs to other organizations: only they (from their settings) or Astro support can reset their two-factor authentication.',
      );
    }
    await this.prisma.user.update({
      where: { id: m.userId },
      data: { twoFactorEnabled: false, twoFactorSecret: null, recoveryCodes: [] },
    });
    const appUrl = escapeHtml(this.config.get('APP_URL'));
    await this.mail.send({
      to: m.user.email,
      subject: 'Astro — two-factor authentication reset / authentification à deux facteurs réinitialisée',
      html: `<p>An administrator of <b>${escapeHtml(m.organization.name)}</b> has reset your two-factor authentication.
             You can sign in with your password only and enable it again from <a href="${appUrl}/settings">your settings</a>.</p>
             <p>Un administrateur de <b>${escapeHtml(m.organization.name)}</b> a réinitialisé votre authentification à deux facteurs.
             Vous pouvez vous connecter avec votre mot de passe et la réactiver depuis <a href="${appUrl}/settings">vos paramètres</a>.</p>
             <p>If you did not expect this, contact your administrator. / Si vous n'êtes pas à l'origine de cette demande, contactez votre administrateur.</p>`,
    });
    return { reset: true, wasEnabled: m.user.twoFactorEnabled };
  }

  // ── invitation resend (set-password link, or accept link for a verified account) ─
  async resendInvite(orgId: string, membershipId: string) {
    const m = await this.getMembership(orgId, membershipId);
    await this.invitations.resend(m.id);
    return { sent: true };
  }

  // ── bulk ────────────────────────────────────────────────────────────────────
  async bulk(orgId: string, actorId: string, input: BulkMembersInput) {
    const ids = [...new Set(input.membershipIds)];
    if (!ids.length) return { updated: 0 };
    if (ids.length > 200) throw new BadRequestException('At most 200 members per bulk operation');
    const members = await this.prisma.membership.findMany({
      where: { id: { in: ids }, organizationId: orgId, deletedAt: null },
      select: { id: true, userId: true, roleId: true, isActive: true, departmentId: true, extraDepartmentIds: true },
    });
    if (members.length !== ids.length) throw new NotFoundException('Membership not found');

    const departmentId = input.departmentId === '' ? null : input.departmentId;
    await this.assertDepartments(orgId, [
      departmentId,
      ...(input.addExtraDepartmentIds ?? []),
    ]);
    const groupIds = [...new Set([...(input.addGroupIds ?? []), ...(input.removeGroupIds ?? [])])];
    if (groupIds.length) {
      const n = await this.prisma.userGroup.count({ where: { id: { in: groupIds }, organizationId: orgId, deletedAt: null } });
      if (n !== groupIds.length) throw new BadRequestException('Unknown group for this organization');
    }

    // last-admin guard
    const losing = new Set<string>();
    if (input.roleId) {
      const role = await this.prisma.role.findFirst({ where: { id: input.roleId, organizationId: orgId } });
      if (!role) throw new BadRequestException('Unknown role for this organization');
      if (role.key !== 'org_admin') members.filter((m) => m.roleId !== role.id).forEach((m) => losing.add(m.id));
    }
    if (input.isActive === false) {
      if (members.some((m) => m.userId === actorId)) {
        throw new BadRequestException('You cannot deactivate your own account');
      }
      members.forEach((m) => losing.add(m.id));
    }
    await this.assertAdminsRemain(orgId, [...losing]);
    if (input.isActive === true) {
      const reactivating = members.filter((m) => !m.isActive).length;
      if (reactivating) await this.subs.assertSeatAvailable(orgId, reactivating);
    }

    const add = new Set(input.addExtraDepartmentIds ?? []);
    const remove = new Set(input.removeExtraDepartmentIds ?? []);
    const touchExtras = add.size > 0 || remove.size > 0 || departmentId !== undefined;
    const now = new Date();

    await this.prisma.$transaction(async (tx) => {
      for (const m of members) {
        const data: Prisma.MembershipUncheckedUpdateInput = {};
        if (input.roleId) data.roleId = input.roleId;
        if (departmentId !== undefined) data.departmentId = departmentId;
        if (touchExtras) {
          const main = departmentId !== undefined ? departmentId : m.departmentId;
          const extras = new Set(m.extraDepartmentIds);
          add.forEach((d) => extras.add(d));
          remove.forEach((d) => extras.delete(d));
          data.extraDepartmentIds = [...extras].filter((d) => d && d !== main);
        }
        if (input.isActive !== undefined && m.isActive !== input.isActive) {
          data.isActive = input.isActive;
          data.deactivatedAt = input.isActive ? null : now;
        }
        if (Object.keys(data).length) await tx.membership.update({ where: { id: m.id }, data });
      }
      const userIds = members.map((m) => m.userId);
      if (input.addGroupIds?.length) {
        await tx.userGroupMember.createMany({
          data: input.addGroupIds.flatMap((groupId) => userIds.map((userId) => ({ groupId, userId }))),
          skipDuplicates: true,
        });
      }
      if (input.removeGroupIds?.length) {
        await tx.userGroupMember.deleteMany({ where: { groupId: { in: input.removeGroupIds }, userId: { in: userIds } } });
      }
    });

    if (input.isActive === false) {
      for (const m of members.filter((x) => x.isActive)) await this.revokeSessionsIfNoOtherMembership(m.userId, m.id);
    }
    return { updated: members.length };
  }

  private async assertDepartments(orgId: string, ids: (string | null | undefined)[]) {
    const unique = [...new Set(ids.filter((id): id is string => !!id))];
    if (!unique.length) return;
    const count = await this.prisma.department.count({
      where: { id: { in: unique }, deletedAt: null, site: { organizationId: orgId, deletedAt: null } },
    });
    if (count !== unique.length) throw new BadRequestException('Unknown department for this organization');
  }

  // ── « Voir comme » ──────────────────────────────────────────────────────────
  async effectiveAccess(orgId: string, membershipId: string) {
    const m = await this.getMembership(orgId, membershipId);
    const [rolePerms, groupRows, sub] = await Promise.all([
      this.prisma.rolePermission.findMany({
        where: { roleId: m.roleId },
        select: { permission: { select: { resource: true, action: true } } },
      }),
      this.prisma.userGroupMember.findMany({
        where: { userId: m.userId, group: { organizationId: orgId, deletedAt: null } },
        select: { group: { select: { id: true, name: true, description: true, color: true, departmentIds: true } } },
      }),
      this.prisma.subscription.findUnique({ where: { organizationId: orgId }, select: { addons: true } }),
    ]);
    const locked = lockedAddonResources(licensedAddons(sub?.addons));
    const permissions = rolePerms
      .filter((rp) => !locked.has(rp.permission.resource))
      .map((rp) => `${rp.permission.resource}:${rp.permission.action}`).sort();
    const granted = new Set(permissions);
    const groups = groupRows.map((r) => r.group);

    const extraIds = (m.extraDepartmentIds ?? []).filter((d) => d && d !== m.departmentId);
    const allDeptIds = [...new Set([m.departmentId, ...extraIds, ...groups.flatMap((g) => g.departmentIds)].filter(Boolean) as string[])];
    const depts = allDeptIds.length
      ? await this.prisma.department.findMany({ where: { id: { in: allDeptIds } }, select: { id: true, name: true } })
      : [];
    const deptName = new Map(depts.map((d) => [d.id, d.name]));
    const dept = (id: string) => ({ id, name: deptName.get(id) ?? null });

    const policy = resolvePolicy(m.organization.settings);
    const access: DepartmentAccess = {
      userId: m.userId,
      organizationId: orgId,
      departmentScoped: m.role.departmentScoped,
      departmentIds: [...new Set([m.departmentId, ...extraIds].filter(Boolean) as string[])],
      policy,
    };
    const current = getHistoryContext();
    const baseCtx: HistoryContext = current ?? {
      actorId: null,
      organizationId: orgId,
      ip: null,
      userAgent: null,
      deleteEvents: [],
      touched: [],
    };

    const countAs = async (model: string, scoped: boolean) => {
      const delegate = (this.prisma as any)[model.charAt(0).toLowerCase() + model.slice(1)];
      const where: Record<string, unknown> = {};
      if (HAS_ORG_MODELS.has(model)) where.organizationId = orgId;
      if (SOFT_DELETE_MODELS.has(model)) where.deletedAt = null;
      if (!delegate) return 0;
      if (!scoped) return unscoped(() => delegate.count({ where }) as Promise<number>);
      return runWithHistoryContext({ ...baseCtx, access }, async () => (await delegate.count({ where })) as number);
    };

    const entries = REGISTERS.flatMap((r) => [
      { model: r.model, resource: r.resource, group: r.group, parent: null as string | null, register: r },
      ...(r.children ?? []).map((c) => ({ model: c.model, resource: r.resource, group: r.group, parent: r.model, register: r })),
    ]);
    const registers = [];
    // sequential: the access object memoises its groups/shares lookups for the whole run
    for (const e of entries) {
      const mode = policy[e.register.model] ?? e.register.default;
      const restricted = mode === 'members' || (mode === 'process' && m.role.departmentScoped);
      const [visibleCount, totalCount] = await Promise.all([
        countAs(e.model, true).catch(() => 0),
        countAs(e.model, false).catch(() => 0),
      ]);
      registers.push({
        model: e.model,
        parent: e.parent,
        resource: e.resource,
        group: e.group,
        mode,
        restricted,
        canRead: granted.has(`${e.resource}:read`),
        visibleCount,
        totalCount,
      });
    }

    return {
      member: {
        membershipId: m.id,
        userId: m.userId,
        email: m.user.email,
        firstName: m.user.firstName,
        lastName: m.user.lastName,
        jobTitle: m.jobTitle,
        isActive: m.isActive,
        deactivatedAt: m.deactivatedAt,
        twoFactorEnabled: m.user.twoFactorEnabled,
      },
      role: { id: m.role.id, name: m.role.name, key: m.role.key, departmentScoped: m.role.departmentScoped },
      permissions,
      departments: {
        main: m.departmentId ? dept(m.departmentId) : null,
        extra: extraIds.map(dept),
        fromGroups: groups
          .filter((g) => g.departmentIds.length)
          .map((g) => ({ groupId: g.id, groupName: g.name, departmentIds: g.departmentIds, departments: g.departmentIds.map(dept) })),
      },
      groups: groups.map((g) => ({ id: g.id, name: g.name, description: g.description, color: g.color, departments: g.departmentIds.map(dept) })),
      registers,
    };
  }
}

import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { paginate, PaginationQuery } from '../../common/dto/pagination.dto';
import { RbacService } from '../../core/rbac/rbac.service';
import { InvitationsService } from '../../core/auth/invitations.service';
import { MailService } from '../../core/mail/mail.service';
import { PlatformAuditService, PlatformAuditInput } from './platform-audit.service';
import { SubscriptionsService } from './subscriptions.service';

type Actor = { actorId?: string; actorEmail?: string; ip?: string; userAgent?: string };

/**
 * Super Admin operations over the whole platform: organizations, seats, accounts,
 * subscriptions and stats. Every sensitive mutation is written to the immutable
 * PlatformAuditLog. Never tenant-scoped — callers must be isSuperAdmin.
 */
@Injectable()
export class PlatformService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly rbac: RbacService,
    private readonly subs: SubscriptionsService,
    private readonly audit: PlatformAuditService,
    private readonly invitations: InvitationsService,
    private readonly mail: MailService,
  ) {}

  private log(actor: Actor, entry: Omit<PlatformAuditInput, keyof Actor>) {
    return this.audit.record({ ...actor, ...entry });
  }

  // ── platform overview ────────────────────────────────────────────────────
  async stats() {
    const [orgsByStatus, subsByStatus, totalUsers, activeMemberships, plans] = await Promise.all([
      this.prisma.organization.groupBy({ by: ['status'], where: { deletedAt: null }, _count: true }),
      this.prisma.subscription.groupBy({ by: ['status'], _count: true }),
      this.prisma.user.count({ where: { deletedAt: null, isSuperAdmin: false } }),
      this.prisma.membership.count({ where: { deletedAt: null, isActive: true } }),
      this.prisma.plan.findMany({ where: { isActive: true }, select: { id: true, priceMonthly: true } }),
    ]);
    const byStatus = (rows: { status: string; _count: number }[]) =>
      Object.fromEntries(rows.map((r) => [r.status, r._count]));
    const orgStatus = byStatus(orgsByStatus as never);

    // MRR estimate from active/trialing subscriptions on public monthly prices
    const activeSubs = await this.prisma.subscription.findMany({
      where: { status: { in: ['ACTIVE', 'TRIALING', 'PAST_DUE'] } },
      include: { plan: { select: { priceMonthly: true } } },
    });
    const mrr = activeSubs.reduce(
      (sum, s) => sum + Number(s.plan.priceMonthly ?? 0) + this.subs.addonsMonthlyPrice(s.addons),
      0,
    );

    return {
      organizations: {
        total: (orgsByStatus as { _count: number }[]).reduce((a, r) => a + r._count, 0),
        active: orgStatus.ACTIVE ?? 0,
        trial: orgStatus.TRIAL ?? 0,
        suspended: orgStatus.SUSPENDED ?? 0,
      },
      users: { total: totalUsers, activeSeats: activeMemberships },
      subscriptions: byStatus(subsByStatus as never),
      revenue: { mrr, arr: mrr * 12, currency: 'EUR' },
      planCount: plans.length,
    };
  }

  // ── organizations ────────────────────────────────────────────────────────
  async listOrganizations(q: PaginationQuery, filters: { status?: string; planId?: string } = {}) {
    const where: Prisma.OrganizationWhereInput = {
      deletedAt: null,
      ...(filters.status ? { status: filters.status as Prisma.OrganizationWhereInput['status'] } : {}),
      ...(filters.planId ? { subscription: { planId: filters.planId } } : {}),
      ...(q.search ? { OR: [{ name: { contains: q.search, mode: 'insensitive' } }, { slug: { contains: q.search, mode: 'insensitive' } }] } : {}),
    };
    const [orgs, total] = await Promise.all([
      this.prisma.organization.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: q.skip,
        take: q.pageSize,
        include: {
          subscription: { include: { plan: { select: { key: true, name: true } } } },
          _count: { select: { memberships: { where: { deletedAt: null, isActive: true } } } },
        },
      }),
      this.prisma.organization.count({ where }),
    ]);
    const rows = orgs.map((o) => ({
      id: o.id,
      name: o.name,
      slug: o.slug,
      status: o.status,
      createdAt: o.createdAt,
      plan: o.subscription?.plan ?? null,
      subscriptionStatus: o.subscription?.status ?? null,
      renewalAt: o.subscription?.currentPeriodEnd ?? null,
      seatLimit: o.subscription?.seatLimit ?? null,
      activeAccounts: o._count.memberships,
    }));
    return paginate(rows, total, q);
  }

  async organizationDetail(orgId: string) {
    const org = await this.prisma.organization.findFirst({
      where: { id: orgId, deletedAt: null },
      include: {
        subscription: { include: { plan: true } },
        invoices: { orderBy: { issuedAt: 'desc' }, take: 12 },
        _count: { select: { sites: true, roles: true } },
      },
    });
    if (!org) throw new NotFoundException('Organization not found');
    const [seats, memberCount, storage, recentAudit] = await Promise.all([
      this.subs.seatInfo(orgId),
      this.prisma.membership.count({ where: { organizationId: orgId, deletedAt: null } }),
      this.prisma.attachment.aggregate({ where: { organizationId: orgId, deletedAt: null }, _sum: { size: true }, _count: true }),
      this.prisma.platformAuditLog.findMany({ where: { organizationId: orgId }, orderBy: { createdAt: 'desc' }, take: 10 }),
    ]);
    return {
      ...org,
      seats,
      memberCount,
      storage: { bytes: storage._sum.size ?? 0, files: storage._count },
      recentAudit,
    };
  }

  async createOrganization(actor: Actor, dto: { name: string; slug: string; planKey?: string; adminEmail: string; adminFirstName: string; adminLastName: string }) {
    const slug = dto.slug.trim().toLowerCase();
    if (await this.prisma.organization.findUnique({ where: { slug } })) {
      throw new BadRequestException('Slug already in use');
    }
    const org = await this.prisma.organization.create({ data: { name: dto.name.trim(), slug, status: 'TRIAL' } });
    // seed the 7 system roles + permissions for the new org, then provision the admin
    const roles = await this.rbac.provisionSystemRoles(org.id);
    const adminRole = roles.find((r) => r.key === 'org_admin');
    if (!adminRole) throw new BadRequestException('Failed to provision org admin role');
    await this.subs.ensureSubscription(org.id, dto.planKey);

    // no password is generated or shown: the admin receives an invitation link (H-1 / L-3)
    const { user, kind } = await this.invitations.prepareInvitee({
      email: dto.adminEmail,
      firstName: dto.adminFirstName,
      lastName: dto.adminLastName,
    });
    const pending = { roleId: adminRole.id, isActive: true, invitedAt: new Date(), acceptedAt: null };
    const membership = await this.prisma.membership.upsert({
      where: { organizationId_userId: { organizationId: org.id, userId: user.id } },
      create: { organizationId: org.id, userId: user.id, isDefault: false, ...pending },
      update: { deletedAt: null, ...pending },
    });
    await this.invitations.sendInvitation(membership.id, kind);
    await this.log(actor, { action: 'organization.created', organizationId: org.id, after: { name: org.name, slug } });
    return { organization: org, admin: { id: user.id, email: user.email }, invitationSent: true };
  }

  async setOrganizationStatus(actor: Actor, orgId: string, status: 'ACTIVE' | 'SUSPENDED', reason?: string) {
    const org = await this.prisma.organization.findFirst({ where: { id: orgId, deletedAt: null } });
    if (!org) throw new NotFoundException('Organization not found');
    const updated = await this.prisma.organization.update({
      where: { id: orgId },
      data: { status, statusReason: reason ?? null, suspendedAt: status === 'SUSPENDED' ? new Date() : null },
    });
    await this.log(actor, {
      action: status === 'SUSPENDED' ? 'organization.suspended' : 'organization.activated',
      organizationId: orgId,
      before: { status: org.status },
      after: { status, reason },
    });
    return updated;
  }

  async deleteOrganization(actor: Actor, orgId: string) {
    const org = await this.prisma.organization.findFirst({ where: { id: orgId, deletedAt: null } });
    if (!org) throw new NotFoundException('Organization not found');
    await this.prisma.organization.update({ where: { id: orgId }, data: { deletedAt: new Date(), status: 'SUSPENDED' } });
    await this.log(actor, { action: 'organization.deleted', organizationId: orgId, before: { name: org.name } });
    return { deleted: true };
  }

  // ── accounts (memberships) ───────────────────────────────────────────────
  async listOrgAccounts(orgId: string, q: PaginationQuery) {
    const where: Prisma.MembershipWhereInput = {
      organizationId: orgId,
      deletedAt: null,
      ...(q.search ? { user: { OR: [{ email: { contains: q.search, mode: 'insensitive' } }, { firstName: { contains: q.search, mode: 'insensitive' } }, { lastName: { contains: q.search, mode: 'insensitive' } }] } } : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.membership.findMany({
        where,
        orderBy: { createdAt: 'asc' },
        skip: q.skip,
        take: q.pageSize,
        include: {
          user: { select: { id: true, email: true, firstName: true, lastName: true, lastLoginAt: true } },
          role: { select: { key: true, name: true } },
        },
      }),
      this.prisma.membership.count({ where }),
    ]);
    return paginate(items, total, q);
  }

  async setAccountActive(actor: Actor, orgId: string, membershipId: string, active: boolean) {
    const membership = await this.prisma.membership.findFirst({ where: { id: membershipId, organizationId: orgId, deletedAt: null } });
    if (!membership) throw new NotFoundException('Account not found');
    if (active) await this.subs.assertSeatAvailable(orgId);
    const updated = await this.prisma.membership.update({
      where: { id: membershipId },
      data: { isActive: active, deactivatedAt: active ? null : new Date() },
    });
    await this.log(actor, {
      action: active ? 'account.activated' : 'account.deactivated',
      organizationId: orgId,
      targetUserId: membership.userId,
      before: { isActive: membership.isActive },
      after: { isActive: active },
    });
    return updated;
  }

  /** Account-level 2FA reset by Astro support (org admins can only do it for single-org users). */
  async resetUserTwoFactor(actor: Actor, userId: string) {
    const user = await this.prisma.user.findFirst({ where: { id: userId, deletedAt: null } });
    if (!user) throw new NotFoundException('User not found');
    await this.prisma.user.update({
      where: { id: userId },
      data: { twoFactorEnabled: false, twoFactorSecret: null, recoveryCodes: [], lastTotpStep: null },
    });
    await this.log(actor, {
      action: 'user.2fa_reset',
      targetUserId: userId,
      before: { twoFactorEnabled: user.twoFactorEnabled },
      after: { twoFactorEnabled: false },
    });
    await this.mail.send({
      to: user.email,
      subject: 'Astro — two-factor authentication reset / authentification à deux facteurs réinitialisée',
      html: `<p>Astro support has reset your two-factor authentication. Enable it again from your settings.
             If you did not request this, contact support immediately.</p>
             <p>Le support Astro a réinitialisé votre authentification à deux facteurs. Réactivez-la depuis vos paramètres.
             Si vous n'êtes pas à l'origine de cette demande, contactez immédiatement le support.</p>`,
    });
    return { reset: true, wasEnabled: user.twoFactorEnabled };
  }
}

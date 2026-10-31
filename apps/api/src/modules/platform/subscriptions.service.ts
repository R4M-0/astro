import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { ADDON_BUNDLE, ADDONS, isAddonKey, normalizeAddons, type AddonKey } from '@astro/shared';
import { StorageQuotaService } from '../../core/files/storage-quota';
import { SELF_HOSTED } from '../../core/license/deployment-mode';
import { currentLicense } from '../../core/license/license.service';
import { PrismaService } from '../../prisma/prisma.service';

export interface SeatInfo {
  limit: number | null; // null = unlimited / custom
  used: number;
  available: number | null;
}

/**
 * Central home for plans, per-organization subscriptions and SEAT accounting.
 * Nothing else in the app computes seat limits or pricing — it all routes here,
 * and quota is enforced server-side (assertSeatAvailable).
 */
@Injectable()
export class SubscriptionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storageQuota: StorageQuotaService,
  ) {}

  // ── plans ────────────────────────────────────────────────────────────────
  listPlans(opts: { publicOnly?: boolean } = {}) {
    return this.prisma.plan.findMany({
      where: { isActive: true, ...(opts.publicOnly ? { isPublic: true } : {}) },
      orderBy: { sortOrder: 'asc' },
    });
  }

  // ── seat accounting ──────────────────────────────────────────────────────
  /** Occupied seats = active, non-deleted memberships in the org. */
  activeSeatCount(orgId: string) {
    return this.prisma.membership.count({
      where: { organizationId: orgId, deletedAt: null, isActive: true },
    });
  }

  async getSubscription(orgId: string) {
    return this.prisma.subscription.findUnique({
      where: { organizationId: orgId },
      include: { plan: true },
    });
  }

  async seatInfo(orgId: string): Promise<SeatInfo> {
    if (SELF_HOSTED) {
      // self-hosted: the signed license caps accounts across the whole installation
      const used = await this.prisma.membership.count({
        where: { deletedAt: null, isActive: true, organization: { deletedAt: null } },
      });
      const limit = currentLicense().payload?.seatLimit ?? 0;
      return { limit, used, available: Math.max(0, limit - used) };
    }
    const [sub, used] = await Promise.all([this.getSubscription(orgId), this.activeSeatCount(orgId)]);
    const limit = sub ? sub.seatLimit : null;
    return { limit, used, available: limit == null ? null : Math.max(0, limit - used) };
  }

  /**
   * Enforced before a seat is consumed (invite / reactivate a member).
   * `delta` extra seats being added in this operation (default 1).
   */
  async assertSeatAvailable(orgId: string, delta = 1): Promise<void> {
    const { limit, used } = await this.seatInfo(orgId);
    if (limit == null) return; // unlimited / no subscription provisioned yet
    if (used + delta > limit) {
      throw new ForbiddenException(
        SELF_HOSTED
          ? 'All accounts allowed by the license are in use. Deactivate an account or extend the license.'
          : "You've reached your organization's account limit. Upgrade your subscription or contact your administrator.",
      );
    }
  }

  // ── add-ons ──────────────────────────────────────────────────────────────
  /** Monthly add-on price: the bundle price when both are on, else the sum. */
  addonsMonthlyPrice(addons: readonly string[]): number {
    const keys = normalizeAddons(addons);
    if (ADDON_BUNDLE.keys.every((k) => keys.includes(k))) return ADDON_BUNDLE.priceMonthly;
    return keys.reduce((sum, k) => sum + ADDONS[k].priceMonthly, 0);
  }

  /** Super-admin only: the add-ons are activated once purchased (never self-served by the org). */
  async setAddons(orgId: string, addons: string[]) {
    const unknown = addons.filter((a) => !isAddonKey(a));
    if (unknown.length) throw new BadRequestException(`Unknown add-on: ${unknown.join(', ')}`);
    const sub = await this.ensureSubscription(orgId);
    return this.prisma.subscription.update({
      where: { id: sub.id },
      data: { addons: normalizeAddons(addons) as AddonKey[] },
      include: { plan: true },
    });
  }

  // ── org-facing view ──────────────────────────────────────────────────────
  async billingOverview(orgId: string) {
    const [sub, seats, storage, invoices] = await Promise.all([
      this.getSubscription(orgId),
      this.seatInfo(orgId),
      this.storageQuota.usage(orgId),
      this.prisma.invoice.findMany({
        where: { organizationId: orgId },
        orderBy: { issuedAt: 'desc' },
        take: 24,
      }),
    ]);
    return {
      subscription: sub,
      seats,
      storage: { usedBytes: storage.used, limitBytes: storage.limit },
      invoices,
      addons: {
        active: normalizeAddons(sub?.addons),
        catalog: Object.values(ADDONS).map(({ key, priceMonthly, priceYearly }) => ({ key, priceMonthly, priceYearly })),
        bundle: ADDON_BUNDLE,
      },
    };
  }

  // ── super-admin mutations ────────────────────────────────────────────────
  /** Create the initial trial subscription for a new org (idempotent). */
  async ensureSubscription(orgId: string, planKey?: string) {
    const existing = await this.prisma.subscription.findUnique({ where: { organizationId: orgId } });
    if (existing) return existing;
    const plan = planKey
      ? await this.prisma.plan.findUnique({ where: { key: planKey } })
      : await this.prisma.plan.findFirst({ where: { isActive: true }, orderBy: { sortOrder: 'asc' } });
    if (!plan) throw new BadRequestException('No plan available to subscribe to');
    const trialEndsAt = new Date(Date.now() + 14 * 86400000);
    return this.prisma.subscription.create({
      data: {
        organizationId: orgId,
        planId: plan.id,
        status: 'TRIALING',
        seatLimit: plan.seatLimit ?? 25,
        trialEndsAt,
        currentPeriodEnd: trialEndsAt,
      },
      include: { plan: true },
    });
  }

  async changePlan(orgId: string, planId: string, opts: { seatLimit?: number; billingCycle?: 'MONTHLY' | 'YEARLY' } = {}) {
    const plan = await this.prisma.plan.findUnique({ where: { id: planId } });
    if (!plan) throw new NotFoundException('Plan not found');
    const sub = await this.ensureSubscription(orgId);
    return this.prisma.subscription.update({
      where: { id: sub.id },
      data: {
        planId,
        seatLimit: opts.seatLimit ?? plan.seatLimit ?? sub.seatLimit,
        ...(opts.billingCycle ? { billingCycle: opts.billingCycle } : {}),
      },
      include: { plan: true },
    });
  }

  async setSeatLimit(orgId: string, seatLimit: number) {
    if (!Number.isInteger(seatLimit) || seatLimit < 0) throw new BadRequestException('Invalid seat limit');
    const sub = await this.ensureSubscription(orgId);
    const used = await this.activeSeatCount(orgId);
    if (seatLimit < used) {
      throw new BadRequestException(`Seat limit cannot be below current usage (${used} active accounts).`);
    }
    return this.prisma.subscription.update({ where: { id: sub.id }, data: { seatLimit }, include: { plan: true } });
  }

  /** Per-org storage override in MB (null = back to the plan's cap). */
  async setStorageLimit(orgId: string, storageLimitMb: number | null) {
    if (storageLimitMb !== null && (!Number.isInteger(storageLimitMb) || storageLimitMb < 0)) {
      throw new BadRequestException('Invalid storage limit');
    }
    const sub = await this.ensureSubscription(orgId);
    return this.prisma.subscription.update({ where: { id: sub.id }, data: { storageLimitMb }, include: { plan: true } });
  }

  async setStatus(orgId: string, status: 'TRIALING' | 'ACTIVE' | 'PAST_DUE' | 'CANCELED' | 'SUSPENDED') {
    const sub = await this.ensureSubscription(orgId);
    return this.prisma.subscription.update({
      where: { id: sub.id },
      data: { status, ...(status === 'CANCELED' ? { canceledAt: new Date(), cancelAtPeriodEnd: true } : {}) },
      include: { plan: true },
    });
  }
}

import { BadRequestException, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { normalizeAddons } from '@astro/shared';
import { createHmac, randomBytes, timingSafeEqual } from 'crypto';
import { existsSync, readFileSync } from 'fs';
import { PrismaService } from '../../prisma/prisma.service';
import { RUNS_JOBS } from '../jobs/app-role';
import { NotificationsService } from '../notifications/notifications.service';
import { RedisService } from '../redis/redis.service';
import { BUILD_DATE, DEPLOYMENT_MODE, licensePublicKey, SELF_HOSTED } from './deployment-mode';
import {
  decodeLicense,
  evaluateLicense,
  LicenseError,
  type LicenseErrorCode,
  type LicensePayload,
  type LicensePhase,
  loadPublicKey,
} from './license-token';

export type LicenseStatus = LicensePhase | 'missing' | 'invalid' | 'clock_tampered';
export type LicenseSource = 'database' | 'file' | 'env';

export interface LicenseState {
  mode: typeof DEPLOYMENT_MODE;
  status: LicenseStatus;
  /** writes are refused (expired past grace, no / invalid license, clock moved back) */
  readOnly: boolean;
  payload: LicensePayload | null;
  source: LicenseSource | null;
  error: { code: LicenseErrorCode | 'CLOCK'; message: string } | null;
  daysLeft: number | null;
  graceEndsAt: string | null;
  instanceId: string | null;
  /** a renewal installed ahead of its start date (takes over once it starts) */
  upcoming: { lid: string; startsAt: string; expiresAt: string } | null;
  checkedAt: string;
}

const REFRESH_MS = 5 * 60_000;
/** the clock may drift / be corrected by this much before it counts as moved back */
const CLOCK_TOLERANCE_MS = 48 * 3_600_000;
/** lastSeenAt is persisted at most this often */
const CLOCK_WRITE_EVERY_MS = 10 * 60_000;
const DAY = 86_400_000;
/** days before expiry on which org admins are notified (then daily during grace) */
const NOTIFY_DAYS = new Set([30, 14, 7, 3, 1, 0]);
const INSTALL_ID = 'install';
/** licenses kept in InstallState.licenseTokens (current + renewals ahead of time) */
const MAX_STORED_LICENSES = 5;

const SAAS_STATE: LicenseState = {
  mode: 'saas',
  status: 'active',
  readOnly: false,
  payload: null,
  source: null,
  error: null,
  daysLeft: null,
  graceEndsAt: null,
  instanceId: null,
  upcoming: null,
  checkedAt: new Date(0).toISOString(),
};

let current: LicenseState = SELF_HOSTED
  ? { ...SAAS_STATE, mode: 'self-hosted', status: 'missing', readOnly: true }
  : SAAS_STATE;

/** A renewal is installed and starts before the current license stops working. */
export function renewalCovers(state: LicenseState): boolean {
  return !!state.upcoming && !!state.graceEndsAt && Date.parse(state.upcoming.startsAt) <= Date.parse(state.graceEndsAt);
}

/** Latest license state of this process (cheap, synchronous — for guards). */
export function currentLicense(): LicenseState {
  return current;
}

/**
 * Add-ons the organization may use. On a self-hosted install the signed license
 * is the only source of truth — editing Subscription.addons in the database
 * grants nothing.
 */
export function licensedAddons(subscriptionAddons: readonly string[] | null | undefined): string[] {
  if (!SELF_HOSTED) return normalizeAddons(subscriptionAddons);
  return current.payload ? normalizeAddons(current.payload.addons) : [];
}

/**
 * Self-hosted licensing: loads the license (Admin upload → LICENSE_FILE →
 * LICENSE_KEY), verifies it against the public key embedded in the build,
 * guards against the clock being moved back, mirrors the licensed limits onto
 * every organization's Subscription row and warns admins before expiry.
 * A no-op on the SaaS.
 */
@Injectable()
export class LicenseService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(LicenseService.name);
  private timer?: NodeJS.Timeout;
  private booted = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly notifications: NotificationsService,
  ) {}

  async onModuleInit() {
    if (!SELF_HOSTED) return;
    await this.refresh();
    this.timer = setInterval(() => void this.refresh().catch((e) => this.logger.error(e)), REFRESH_MS);
    this.timer.unref();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  state(): LicenseState {
    return current;
  }

  // ── install identity ─────────────────────────────────────────────────────
  async installState() {
    const existing = await this.prisma.installState.findUnique({ where: { id: INSTALL_ID } });
    if (existing) return existing;
    return this.prisma.installState.upsert({
      where: { id: INSTALL_ID },
      create: { id: INSTALL_ID, instanceId: `QI-${randomBytes(12).toString('base64url')}` },
      update: {},
    });
  }

  // ── refresh ──────────────────────────────────────────────────────────────
  async refresh(): Promise<LicenseState> {
    if (!SELF_HOSTED) return current;
    const install = await this.installState();
    const now = new Date();
    const next = this.resolve(install.licenseTokens, install.instanceId, now);
    const clock = await this.checkClock(install, now);
    if (!clock.ok && next.payload) {
      next.status = 'clock_tampered';
      next.readOnly = true;
      next.error = { code: 'CLOCK', message: clock.message };
    }
    const changed = !this.booted || next.status !== current.status || next.payload?.lid !== current.payload?.lid;
    this.booted = true;
    current = next;
    if (changed) this.logger.log(`license ${next.status}${next.payload ? ` (${next.payload.lid}, expires ${next.payload.expiresAt.slice(0, 10)})` : ''}`);
    await this.syncSubscriptions(next).catch((e) => this.logger.warn(`subscription sync failed: ${(e as Error).message}`));
    if (RUNS_JOBS) await this.notifyExpiry(next).catch((e) => this.logger.warn(`expiry notice failed: ${(e as Error).message}`));
    return next;
  }

  /** Every configured license, verified; the valid one that expires last wins. */
  private resolve(dbTokens: string[], instanceId: string, now: Date): LicenseState {
    const base: LicenseState = {
      mode: 'self-hosted',
      status: 'missing',
      readOnly: true,
      payload: null,
      source: null,
      error: null,
      daysLeft: null,
      graceEndsAt: null,
      instanceId,
      upcoming: null,
      checkedAt: now.toISOString(),
    };
    const candidates = this.candidates(dbTokens);
    if (!candidates.length) return base;

    const keyText = licensePublicKey();
    if (!keyText) {
      return { ...base, status: 'invalid', error: { code: 'NO_PUBLIC_KEY', message: 'This build has no license public key' } };
    }
    const publicKey = loadPublicKey(keyText);
    let best: { payload: LicensePayload; source: LicenseSource; ev: ReturnType<typeof evaluateLicense> } | null = null;
    let firstError: LicenseError | null = null;
    let upcoming: LicensePayload | null = null;
    for (const { token, source } of candidates) {
      let payload: LicensePayload | null = null;
      try {
        payload = decodeLicense(token, publicKey);
        const ev = evaluateLicense(payload, { now, instanceId, buildDate: BUILD_DATE });
        if (!best || Date.parse(payload.expiresAt) > Date.parse(best.payload.expiresAt)) best = { payload, source, ev };
      } catch (e) {
        const err = e instanceof LicenseError ? e : new LicenseError('MALFORMED', (e as Error).message);
        if (err.code === 'NOT_YET_VALID' && payload) {
          if (!upcoming || Date.parse(payload.startsAt) < Date.parse(upcoming.startsAt)) upcoming = payload;
        } else {
          firstError ??= err;
        }
      }
    }
    const upcomingView = upcoming ? { lid: upcoming.lid, startsAt: upcoming.startsAt, expiresAt: upcoming.expiresAt } : null;
    if (!best) {
      const error = firstError ?? new LicenseError('NOT_YET_VALID', `The installed license starts on ${upcoming!.startsAt.slice(0, 10)}`);
      return { ...base, status: 'invalid', upcoming: upcomingView, error: { code: error.code, message: error.message } };
    }
    return {
      ...base,
      status: best.ev.phase,
      readOnly: best.ev.readOnly,
      payload: best.payload,
      source: best.source,
      daysLeft: best.ev.daysLeft,
      graceEndsAt: best.ev.graceEndsAt.toISOString(),
      upcoming: upcomingView,
    };
  }

  private candidates(dbTokens: string[]): { token: string; source: LicenseSource }[] {
    const out: { token: string; source: LicenseSource }[] = dbTokens.map((token) => ({ token, source: 'database' as const }));
    const file = process.env.LICENSE_FILE ?? '/etc/astro/license.lic';
    try {
      if (existsSync(file)) {
        const text = readFileSync(file, 'utf8').trim();
        if (text) out.push({ token: text, source: 'file' });
      }
    } catch (e) {
      this.logger.warn(`cannot read LICENSE_FILE ${file}: ${(e as Error).message}`);
    }
    if (process.env.LICENSE_KEY?.trim()) out.push({ token: process.env.LICENSE_KEY.trim(), source: 'env' });
    return out;
  }

  // ── tamper-evident clock ─────────────────────────────────────────────────
  private clockMac(instanceId: string, at: Date): string {
    const key = process.env.APP_ENCRYPTION_KEY || process.env.JWT_ACCESS_SECRET || 'astro-install-clock';
    return createHmac('sha256', key).update(`${instanceId}|${at.toISOString()}`).digest('base64url');
  }

  private macMatches(expected: string, actual: string | null): boolean {
    if (!actual) return false;
    const a = Buffer.from(expected);
    const b = Buffer.from(actual);
    return a.length === b.length && timingSafeEqual(a, b);
  }

  /**
   * The latest time this install has seen is stored with an HMAC. A clock set
   * back beyond the tolerance, or an edited timestamp, stops the license until
   * a license is (re-)uploaded — which resets the clock record.
   */
  private async checkClock(
    install: { instanceId: string; lastSeenAt: Date | null; lastSeenMac: string | null },
    now: Date,
  ): Promise<{ ok: true } | { ok: false; message: string }> {
    const { lastSeenAt, lastSeenMac, instanceId } = install;
    if (lastSeenAt && !this.macMatches(this.clockMac(instanceId, lastSeenAt), lastSeenMac)) {
      return { ok: false, message: 'The installation clock record was modified. Upload the license again to continue.' };
    }
    if (lastSeenAt && now.getTime() < lastSeenAt.getTime() - CLOCK_TOLERANCE_MS) {
      return {
        ok: false,
        message: `The server clock is behind the last recorded time (${lastSeenAt.toISOString()}). Fix the system time.`,
      };
    }
    if (!lastSeenAt || now.getTime() - lastSeenAt.getTime() > CLOCK_WRITE_EVERY_MS) {
      await this.prisma.installState.update({
        where: { id: INSTALL_ID },
        data: { lastSeenAt: now, lastSeenMac: this.clockMac(instanceId, now) },
      });
    }
    return { ok: true };
  }

  // ── upload ───────────────────────────────────────────────────────────────
  /**
   * Verifies and stores a license uploaded from Admin → Licence (or the CLI).
   * A renewal may be installed before its start date: it is kept next to the
   * current license and takes over when it starts.
   */
  async install(token: string, userId: string | null): Promise<LicenseState> {
    if (!SELF_HOSTED) throw new BadRequestException('Licenses only apply to self-hosted installations');
    const trimmed = token.trim();
    const install = await this.installState();
    const keyText = licensePublicKey();
    if (!keyText) throw new BadRequestException({ error: 'LICENSE_INVALID', code: 'NO_PUBLIC_KEY', message: 'This build has no license public key' });
    const publicKey = loadPublicKey(keyText);
    const now = new Date();
    /** still worth keeping: usable now or starting later (not expired, not for another install) */
    const keepable = (token: string, reject: boolean): boolean => {
      try {
        const payload = decodeLicense(token, publicKey);
        try {
          if (evaluateLicense(payload, { now, instanceId: install.instanceId, buildDate: BUILD_DATE }).readOnly) {
            if (reject) {
              throw new BadRequestException({ error: 'LICENSE_INVALID', code: 'EXPIRED', message: `This license expired on ${payload.expiresAt.slice(0, 10)}` });
            }
            return false;
          }
        } catch (e) {
          if (e instanceof LicenseError && e.code === 'NOT_YET_VALID') return true;
          throw e;
        }
        return true;
      } catch (e) {
        if (!reject) return false;
        if (e instanceof BadRequestException) throw e;
        const err = e instanceof LicenseError ? e : new LicenseError('MALFORMED', (e as Error).message);
        throw new BadRequestException({ error: 'LICENSE_INVALID', code: err.code, message: err.message });
      }
    };
    keepable(trimmed, true);
    const tokens = [trimmed, ...install.licenseTokens.filter((t) => t !== trimmed && keepable(t, false))].slice(0, MAX_STORED_LICENSES);
    await this.prisma.installState.update({
      where: { id: INSTALL_ID },
      data: {
        licenseTokens: tokens,
        licenseInstalledAt: now,
        licenseInstalledById: userId,
        // a freshly verified license re-anchors the tamper-evident clock
        lastSeenAt: now,
        lastSeenMac: this.clockMac(install.instanceId, now),
      },
    });
    return this.refresh();
  }

  // ── limits ───────────────────────────────────────────────────────────────
  /** Active accounts across the whole installation (the license counts seats per install). */
  installSeatsUsed() {
    return this.prisma.membership.count({
      where: { deletedAt: null, isActive: true, organization: { deletedAt: null } },
    });
  }

  organizationCount() {
    return this.prisma.organization.count({ where: { deletedAt: null } });
  }

  /**
   * Mirrors the license onto each organization's Subscription so the existing
   * billing screen, storage quota and seat accounting show licensed values.
   * Checked on every refresh (new organizations, edited rows) but written only
   * when something differs — each write invalidates the auth cache.
   */
  private async syncSubscriptions(state: LicenseState) {
    const p = state.payload;
    if (!p) return;
    const status = state.readOnly ? 'PAST_DUE' : 'ACTIVE';
    const plan =
      (await this.prisma.plan.findUnique({ where: { key: p.plan } })) ??
      (await this.prisma.plan.findFirst({ where: { isActive: true }, orderBy: { sortOrder: 'asc' } }));
    if (!plan) return; // seed not run yet — retried on the next refresh
    const addons = normalizeAddons(p.addons);
    const data = {
      planId: plan.id,
      status,
      seatLimit: p.seatLimit,
      storageLimitMb: p.storageLimitMb,
      addons,
      currentPeriodStart: new Date(p.startsAt),
      currentPeriodEnd: new Date(p.expiresAt),
      trialEndsAt: null,
      provider: 'license',
      providerSubscriptionId: p.lid,
    } as const;
    const orgs = await this.prisma.organization.findMany({
      where: { deletedAt: null },
      select: { id: true, subscription: true },
    });
    for (const org of orgs) {
      const sub = org.subscription;
      const same =
        sub &&
        sub.planId === data.planId &&
        sub.status === data.status &&
        sub.seatLimit === data.seatLimit &&
        sub.storageLimitMb === data.storageLimitMb &&
        sub.provider === data.provider &&
        sub.providerSubscriptionId === data.providerSubscriptionId &&
        sub.currentPeriodEnd?.getTime() === data.currentPeriodEnd.getTime() &&
        normalizeAddons(sub.addons).join() === addons.join();
      if (same) continue;
      await this.prisma.subscription.upsert({
        where: { organizationId: org.id },
        create: { organizationId: org.id, ...data, addons: [...addons] },
        update: { ...data, addons: [...addons] },
      });
    }
  }

  // ── expiry notices ───────────────────────────────────────────────────────
  private async notifyExpiry(state: LicenseState) {
    const p = state.payload;
    if (!p || state.daysLeft == null || renewalCovers(state)) return;
    const due = state.status === 'grace' || (state.status === 'expiring' && NOTIFY_DAYS.has(state.daysLeft));
    if (!due) return;
    const today = new Date().toISOString().slice(0, 10);
    if (!(await this.redis.claimRun(`license-expiry:${p.lid}:${today}`, 2 * DAY))) return;

    const expires = p.expiresAt.slice(0, 10);
    const title =
      state.status === 'grace'
        ? `Licence expirée le ${expires} — passage en lecture seule le ${state.graceEndsAt!.slice(0, 10)}`
        : state.daysLeft === 0
          ? `La licence Astro expire aujourd'hui`
          : `La licence Astro expire dans ${state.daysLeft} jour${state.daysLeft > 1 ? 's' : ''} (${expires})`;
    const admins = await this.prisma.membership.findMany({
      where: { deletedAt: null, isActive: true, acceptedAt: { not: null }, role: { key: 'org_admin' }, organization: { deletedAt: null } },
      select: { userId: true, organizationId: true },
    });
    const byOrg = new Map<string, string[]>();
    for (const m of admins) byOrg.set(m.organizationId, [...(byOrg.get(m.organizationId) ?? []), m.userId]);
    for (const [organizationId, userIds] of byOrg) {
      await this.notifications.notify({
        organizationId,
        userIds,
        type: 'license_expiring',
        title,
        body: 'Contactez Astro pour renouveler, puis importez la nouvelle licence dans Administration → Licence.',
        link: '/admin?tab=license',
      });
    }
  }
}

import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { randomBytes } from 'crypto';
import type Redis from 'ioredis';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { AuthWriteEvent, onAuthWrite } from './auth-write-bus';

/** Upper bound on staleness if an invalidation is ever missed (e.g. Redis down). */
const TTL_MS = 30_000;
const MAX_ENTRIES = 20_000;
const CHANNEL = 'astro:auth-invalidate';
/** Re-invalidate after this delay: a write inside a transaction commits after our hook ran. */
const LATE_REPLAY_MS = 1_000;

type Tag = string; // u:<userId> s:<sessionId> o:<orgId> r:<roleId> m:<membershipId>
type Scope = Tag[] | 'all' | null;

interface Entry {
  value: unknown;
  tags: Tag[];
  expiresAt: number;
}

const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);

/** Finds `key` on a where clause, including inside a compound-unique object. */
function pick(where: any, key: string): string | undefined {
  if (!where || typeof where !== 'object') return undefined;
  if (str(where[key])) return where[key];
  for (const v of Object.values(where)) {
    if (v && typeof v === 'object' && str((v as any)[key])) return (v as any)[key];
  }
  return undefined;
}

/**
 * Per-process cache of the per-request auth context (session validity, user
 * flags, resolved membership + permission set), replacing 3 DB round-trips —
 * one of them a ~300-row permission join — on every authenticated request.
 *
 * Correctness comes from invalidation, not the TTL: every write to Session /
 * User / Membership / Role / RolePermission / Organization (seen by the Prisma
 * extension) drops the affected entries here and, via Redis pub/sub, on every
 * other replica. The 30 s TTL only bounds staleness if a message is lost.
 */
@Injectable()
export class AuthCacheService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AuthCacheService.name);
  private readonly entries = new Map<string, Entry>();
  private readonly instanceId = randomBytes(6).toString('hex');
  private sub?: Redis;
  private unsubscribeBus?: () => void;
  readonly enabled = process.env.AUTH_CACHE !== 'off';

  constructor(
    private readonly redis: RedisService,
    private readonly prisma: PrismaService,
  ) {}

  onModuleInit() {
    if (!this.enabled) return;
    this.unsubscribeBus = onAuthWrite((e) => this.onWrite(e));
    this.sub = this.redis.connect('auth-sub');
    this.sub.options.enableOfflineQueue = true; // (re)subscribe once Redis is reachable
    void this.sub.subscribe(CHANNEL).catch((err) => this.logger.warn(`subscribe failed: ${err.message}`));
    this.sub.on('message', (_channel, raw: string) => {
      try {
        const msg = JSON.parse(raw) as { from: string; scope: Scope };
        if (msg.from !== this.instanceId) this.applyLocal(msg.scope);
      } catch {
        /* ignore malformed */
      }
    });
    // a replica that lost Redis may have missed invalidations: start clean on reconnect
    this.sub.on('ready', () => this.entries.clear());
  }

  onModuleDestroy() {
    this.unsubscribeBus?.();
    this.sub?.disconnect();
  }

  /** Cached value or `load()`; `tagsOf` labels the entry for targeted invalidation. */
  async getOrLoad<T>(key: string, load: () => Promise<T>, tagsOf: (value: NonNullable<T>) => Tag[]): Promise<T> {
    if (!this.enabled) return load();
    const hit = this.entries.get(key);
    if (hit && hit.expiresAt > Date.now()) return hit.value as T;
    const value = await load();
    // negative results (null) are never cached: they end in a 401/403 anyway
    if (value !== null && value !== undefined) {
      if (this.entries.size >= MAX_ENTRIES) this.evict();
      this.entries.set(key, { value, tags: tagsOf(value as NonNullable<T>), expiresAt: Date.now() + TTL_MS });
    }
    return value;
  }

  /** Drops entries matching `scope` here and on every other replica. */
  async invalidate(scope: Scope): Promise<void> {
    if (!scope) return;
    this.applyLocal(scope);
    await this.redis.client
      .publish(CHANNEL, JSON.stringify({ from: this.instanceId, scope }))
      .catch(() => undefined); // offline: peers fall back to the TTL
  }

  get size() {
    return this.entries.size;
  }

  private applyLocal(scope: Scope) {
    if (!scope) return;
    if (scope === 'all') {
      this.entries.clear();
      return;
    }
    const drop = new Set(scope);
    for (const [key, entry] of this.entries) {
      if (entry.tags.some((t) => drop.has(t))) this.entries.delete(key);
    }
  }

  private evict() {
    const now = Date.now();
    for (const [key, entry] of this.entries) if (entry.expiresAt <= now) this.entries.delete(key);
    // still full: drop the oldest insertions (Map preserves insertion order)
    let excess = this.entries.size - MAX_ENTRIES * 0.9;
    for (const key of this.entries.keys()) {
      if (excess-- <= 0) break;
      this.entries.delete(key);
    }
  }

  private async onWrite(event: AuthWriteEvent) {
    const scope = await this.scopeOf(event);
    await this.invalidate(scope);
    if (scope) setTimeout(() => void this.invalidate(scope), LATE_REPLAY_MS).unref();
  }

  /** Which cached entries a write can affect. Unknown shapes → everything (safe default). */
  private async scopeOf({ model, operation, args }: AuthWriteEvent): Promise<Scope> {
    const where = args?.where;
    const creating = operation === 'create' || operation.startsWith('createMany');
    const data = Array.isArray(args?.data) ? args.data : [args?.data ?? {}];

    switch (model) {
      case 'Session': {
        if (creating) return null; // a new session invalidates nothing
        const id = pick(where, 'id');
        if (id) return [`s:${id}`];
        const userId = pick(where, 'userId');
        return userId ? [`u:${userId}`] : 'all';
      }
      case 'User': {
        if (creating) return null;
        const id = pick(where, 'id');
        return id ? [`u:${id}`] : 'all';
      }
      case 'Organization': {
        if (creating) return null;
        const id = pick(where, 'id');
        return id ? [`o:${id}`] : 'all';
      }
      case 'Subscription': {
        // add-ons gate the granted permissions of every member of the org
        const orgIds = creating ? data.map((d: any) => str(d?.organizationId)) : [pick(where, 'organizationId')];
        if (orgIds.every(Boolean)) return orgIds.map((o: string) => `o:${o}`);
        const id = pick(where, 'id');
        if (id) {
          const sub = await this.prisma.subscription.findUnique({ where: { id }, select: { organizationId: true } }).catch(() => null);
          if (sub) return [`o:${sub.organizationId}`];
        }
        return 'all';
      }
      case 'Role': {
        if (creating) return null;
        const id = pick(where, 'id');
        return id ? [`r:${id}`] : 'all';
      }
      case 'RolePermission': {
        const roleIds = creating ? data.map((d: any) => str(d?.roleId)) : [pick(where, 'roleId')];
        return roleIds.every(Boolean) ? roleIds.map((r: string) => `r:${r}`) : 'all';
      }
      case 'Membership': {
        // a user's "default org" resolution can change with any of their memberships → scope by user
        const userIds = creating ? data.map((d: any) => str(d?.userId)) : [pick(where, 'userId')];
        if (userIds.every(Boolean)) return userIds.map((u: string) => `u:${u}`);
        const id = pick(where, 'id');
        if (id) {
          const m = await this.prisma.membership.findUnique({ where: { id }, select: { userId: true } }).catch(() => null);
          return m ? [`u:${m.userId}`, `m:${id}`] : [`m:${id}`];
        }
        const orgId = pick(where, 'organizationId');
        return orgId ? [`o:${orgId}`] : 'all';
      }
      default:
        return null;
    }
  }
}

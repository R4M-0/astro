import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { randomBytes } from 'crypto';
import type Redis from 'ioredis';
import { RedisService } from '../redis/redis.service';
import { onOrgWrite } from './org-write-bus';
import { getHistoryContext } from '../history/history-context';

const TTL_MS = 60_000; // safety net only — writes invalidate
const CHANNEL = 'astro:org-invalidate';
const COALESCE_MS = 250;
/** Second invalidation for writes inside transactions that commit after the hook ran. */
const LATE_REPLAY_MS = 1_000;
const ALL = '*';

/**
 * Per-process cache for per-organization read models that are expensive to
 * compute and identical for every member (dashboard aggregates, compliance).
 * Any write in the org drops that org's entries here and — via Redis pub/sub,
 * coalesced per org — on every other replica.
 */
@Injectable()
export class OrgCacheService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OrgCacheService.name);
  private readonly orgs = new Map<string, Map<string, { value: unknown; expiresAt: number }>>();
  private readonly instanceId = randomBytes(6).toString('hex');
  private readonly pending = new Set<string>();
  private flushTimer?: NodeJS.Timeout;
  private sub?: Redis;
  private unsubscribeBus?: () => void;
  readonly enabled = process.env.ORG_CACHE !== 'off';

  constructor(private readonly redis: RedisService) {}

  onModuleInit() {
    if (!this.enabled) return;
    this.unsubscribeBus = onOrgWrite((orgId) => {
      const key = orgId ?? ALL;
      this.drop(key);
      this.publish(key);
      setTimeout(() => this.drop(key), LATE_REPLAY_MS).unref();
    });
    this.sub = this.redis.connect('org-sub');
    this.sub.options.enableOfflineQueue = true;
    void this.sub.subscribe(CHANNEL).catch((err) => this.logger.warn(`subscribe failed: ${err.message}`));
    this.sub.on('message', (_c, raw: string) => {
      try {
        const msg = JSON.parse(raw) as { from: string; orgs: string[] };
        if (msg.from !== this.instanceId) msg.orgs.forEach((o) => this.drop(o));
      } catch {
        /* ignore malformed */
      }
    });
    this.sub.on('ready', () => this.orgs.clear()); // missed messages while disconnected
  }

  onModuleDestroy() {
    this.unsubscribeBus?.();
    clearTimeout(this.flushTimer);
    this.sub?.disconnect();
  }

  async getOrLoad<T>(orgId: string, key: string, load: () => Promise<T>): Promise<T> {
    if (!this.enabled) return load();
    // what a member sees depends on visibility rules (process / members-only registers): figures are
    // cached per user, still dropped on every write of the organization
    const userId = getHistoryContext()?.access?.userId;
    if (userId) key = `${key}|u:${userId}`;
    const hit = this.orgs.get(orgId)?.get(key);
    if (hit && hit.expiresAt > Date.now()) return hit.value as T;
    const value = await load();
    let entries = this.orgs.get(orgId);
    if (!entries) this.orgs.set(orgId, (entries = new Map()));
    entries.set(key, { value, expiresAt: Date.now() + TTL_MS });
    return value;
  }

  private drop(orgId: string) {
    if (orgId === ALL) this.orgs.clear();
    else this.orgs.delete(orgId);
  }

  /** Leading-edge publish, then everything that arrives in the next window as one batch. */
  private publish(orgId: string) {
    if (this.flushTimer) {
      this.pending.add(orgId);
      return;
    }
    this.send([orgId]);
    this.armWindow();
  }

  private armWindow() {
    this.flushTimer = setTimeout(() => {
      this.flushTimer = undefined;
      if (!this.pending.size) return;
      const batch = this.pending.has(ALL) ? [ALL] : [...this.pending];
      this.pending.clear();
      this.send(batch);
      this.armWindow();
    }, COALESCE_MS);
    this.flushTimer.unref();
  }

  private send(orgs: string[]) {
    this.redis.client.publish(CHANNEL, JSON.stringify({ from: this.instanceId, orgs })).catch(() => undefined);
  }
}

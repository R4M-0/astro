import { HttpException, HttpStatus, Injectable, Logger, Optional } from '@nestjs/common';
import { RedisService } from '../redis/redis.service';

/** Failures tolerated inside the window before the key is locked. */
export const MAX_FAILURES = 5;
export const FAILURE_WINDOW_MS = 15 * 60_000;
const BASE_LOCK_MS = 60_000;
const MAX_LOCK_MS = 60 * 60_000;
/** How long successive lockouts keep doubling the next one. */
const LOCKOUT_MEMORY_MS = 24 * 3600_000;

interface Entry {
  value: number;
  expiresAt: number;
}

/**
 * Per-account brute-force protection (M-2), independent of the caller's IP: after
 * MAX_FAILURES failures within FAILURE_WINDOW_MS the key is locked for 1, 2, 4, 8…
 * minutes (capped at 1 h). Counters live in Redis so every replica shares them, with
 * an in-memory fallback when Redis is unreachable (a Redis blip must not open the door
 * nor lock everyone out).
 */
@Injectable()
export class LoginGuardService {
  private readonly logger = new Logger(LoginGuardService.name);
  private readonly memory = new Map<string, Entry>();
  /** overridable clock (tests) */
  now: () => number = () => Date.now();

  constructor(@Optional() private readonly redis?: RedisService) {}

  /** 429 while the key is locked. */
  async assertNotLocked(key: string) {
    const ttl = await this.ttl(`lock:${key}`);
    if (ttl > 0) throw this.lockedError(ttl);
  }

  /** Records a failure; returns `lockedNow` when this failure triggered a lockout. */
  async recordFailure(key: string): Promise<{ failures: number; lockedNow: boolean; lockMs: number }> {
    const failures = await this.incr(`fail:${key}`, FAILURE_WINDOW_MS);
    if (failures < MAX_FAILURES) return { failures, lockedNow: false, lockMs: 0 };
    const lockouts = await this.incr(`lockouts:${key}`, LOCKOUT_MEMORY_MS);
    const lockMs = Math.min(BASE_LOCK_MS * 2 ** (lockouts - 1), MAX_LOCK_MS);
    await this.set(`lock:${key}`, lockMs);
    await this.del(`fail:${key}`);
    return { failures, lockedNow: true, lockMs };
  }

  /** Failures recorded so far in the current window. */
  async failures(key: string): Promise<number> {
    return this.get(`fail:${key}`);
  }

  async reset(key: string) {
    await this.del(`fail:${key}`);
    await this.del(`lock:${key}`);
  }

  lockedError(ttlMs: number) {
    const retryAfterSeconds = Math.max(1, Math.ceil(ttlMs / 1000));
    return new HttpException(
      {
        statusCode: HttpStatus.TOO_MANY_REQUESTS,
        error: 'ACCOUNT_LOCKED',
        message: `Too many failed attempts. Try again in ${Math.ceil(retryAfterSeconds / 60)} minute(s).`,
        retryAfterSeconds,
      },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }

  // ── storage (Redis, in-memory fallback) ─────────────────────────────────────
  private k(key: string) {
    return `astro:login-guard:${key}`;
  }

  private useRedis() {
    return !!this.redis?.ready;
  }

  private memGet(key: string): Entry | undefined {
    const e = this.memory.get(key);
    if (e && e.expiresAt <= this.now()) {
      this.memory.delete(key);
      return undefined;
    }
    return e;
  }

  private async incr(key: string, windowMs: number): Promise<number> {
    if (this.useRedis()) {
      try {
        const n = await this.redis!.client.incr(this.k(key));
        if (n === 1) await this.redis!.client.pexpire(this.k(key), windowMs);
        return n;
      } catch (err) {
        this.logger.warn(`redis unavailable, falling back to memory: ${(err as Error).message}`);
      }
    }
    const e = this.memGet(key);
    const value = (e?.value ?? 0) + 1;
    this.memory.set(key, { value, expiresAt: e?.expiresAt ?? this.now() + windowMs });
    return value;
  }

  private async get(key: string): Promise<number> {
    if (this.useRedis()) {
      try {
        return Number((await this.redis!.client.get(this.k(key))) ?? 0);
      } catch {
        /* fall through */
      }
    }
    return this.memGet(key)?.value ?? 0;
  }

  private async set(key: string, ttlMs: number) {
    if (this.useRedis()) {
      try {
        await this.redis!.client.set(this.k(key), '1', 'PX', ttlMs);
        return;
      } catch {
        /* fall through */
      }
    }
    this.memory.set(key, { value: 1, expiresAt: this.now() + ttlMs });
  }

  private async ttl(key: string): Promise<number> {
    if (this.useRedis()) {
      try {
        return Math.max(0, await this.redis!.client.pttl(this.k(key)));
      } catch {
        /* fall through */
      }
    }
    const e = this.memGet(key);
    return e ? e.expiresAt - this.now() : 0;
  }

  private async del(key: string) {
    if (this.useRedis()) {
      try {
        await this.redis!.client.del(this.k(key));
      } catch {
        /* fall through */
      }
    }
    this.memory.delete(key);
  }
}

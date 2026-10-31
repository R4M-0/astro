import { Injectable, Logger } from '@nestjs/common';
import { ThrottlerStorage, ThrottlerStorageService } from '@nestjs/throttler';
import type { ThrottlerStorageRecord } from '@nestjs/throttler/dist/throttler-storage-record.interface';
import { RedisService } from './redis.service';

// Atomic fixed-window counter + block flag. Returns {hits, windowTtlMs, blockTtlMs}.
const INCREMENT = `
local hits = redis.call('INCR', KEYS[1])
local ttl = redis.call('PTTL', KEYS[1])
if ttl < 0 then
  redis.call('PEXPIRE', KEYS[1], ARGV[1])
  ttl = tonumber(ARGV[1])
end
local block = redis.call('PTTL', KEYS[2])
if block <= 0 and hits > tonumber(ARGV[2]) then
  redis.call('SET', KEYS[2], '1', 'PX', ARGV[3])
  block = tonumber(ARGV[3])
end
return {hits, ttl, block}
`;

/**
 * Rate-limit counters shared by every API replica (the in-memory default
 * multiplies each limit by the replica count and resets on deploy). Same
 * semantics as ThrottlerStorageService; falls back to it when Redis is down so
 * the guard never turns an outage into 500s.
 */
@Injectable()
export class RedisThrottlerStorage implements ThrottlerStorage {
  private readonly logger = new Logger(RedisThrottlerStorage.name);
  private readonly fallback = new ThrottlerStorageService();

  constructor(private readonly redis: RedisService) {}

  async increment(
    key: string,
    ttl: number,
    limit: number,
    blockDuration: number,
    throttlerName: string,
  ): Promise<ThrottlerStorageRecord> {
    if (this.redis.ready) {
      try {
        const base = `astro:throttle:${throttlerName}:${key}`;
        const [hits, windowMs, blockMs] = (await this.redis.client.eval(
          INCREMENT,
          2,
          base,
          `${base}:blocked`,
          ttl,
          limit,
          blockDuration,
        )) as [number, number, number];
        return {
          totalHits: hits,
          timeToExpire: Math.ceil(windowMs / 1000),
          isBlocked: blockMs > 0,
          timeToBlockExpire: Math.max(0, Math.ceil(blockMs / 1000)),
        };
      } catch (err) {
        this.logger.warn(`throttler falling back to memory: ${(err as Error).message}`);
      }
    }
    return this.fallback.increment(key, ttl, limit, blockDuration, throttlerName);
  }
}

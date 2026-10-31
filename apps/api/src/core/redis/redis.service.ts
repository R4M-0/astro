import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

/**
 * Shared Redis connection for cross-process coordination: socket.io fan-out,
 * rate-limit counters and single-run cron claims. Everything built on it must
 * degrade gracefully when Redis is unreachable — a Redis blip may never take the
 * API down.
 */
@Injectable()
export class RedisService implements OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  readonly url: string;
  readonly client: Redis;

  constructor(config: ConfigService) {
    this.url = config.get('REDIS_URL', 'redis://localhost:6379');
    this.client = this.connect('main');
  }

  /** New connection with the shared settings (socket.io pub/sub needs dedicated ones). */
  connect(name: string): Redis {
    const client = new Redis(this.url, {
      connectionName: `astro-api-${name}`,
      maxRetriesPerRequest: 2,
      // fail fast instead of queueing commands forever while disconnected
      enableOfflineQueue: false,
    });
    client.on('error', (err) => this.logger.warn(`redis(${name}): ${err.message}`));
    return client;
  }

  get ready(): boolean {
    return this.client.status === 'ready';
  }

  /**
   * Claims a named run for `ttlMs` across every API/worker process. Returns true
   * for exactly one caller per window. For scheduled jobs that fire at the same
   * instant in each replica: the first claims it, the rest skip.
   *
   * If Redis is unavailable the job runs anyway — a duplicate reminder during an
   * outage is better than a silently missed deadline.
   */
  async claimRun(name: string, ttlMs: number): Promise<boolean> {
    try {
      const ok = await this.client.set(`astro:run:${name}`, process.pid.toString(), 'PX', ttlMs, 'NX');
      return ok === 'OK';
    } catch (err) {
      this.logger.warn(`claimRun(${name}) without Redis — running locally: ${(err as Error).message}`);
      return true;
    }
  }

  async onModuleDestroy() {
    this.client.disconnect();
  }
}

/** Claim window for daily jobs: covers clock skew between replicas, expires well before the next day's run. */
export const CRON_CLAIM_MS = 20 * 3_600_000;

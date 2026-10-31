import { INestApplicationContext, Logger } from '@nestjs/common';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import type Redis from 'ioredis';
import type { ServerOptions } from 'socket.io';
import { RedisService } from './redis.service';

/**
 * socket.io adapter that relays room broadcasts through Redis pub/sub, so an
 * `emitToUser` from one API replica reaches sockets connected to any other.
 */
export class RedisIoAdapter extends IoAdapter {
  private readonly logger = new Logger(RedisIoAdapter.name);
  private adapter?: ReturnType<typeof createAdapter>;

  constructor(app: INestApplicationContext) {
    super(app);
    const redis = app.get(RedisService);
    // pub/sub need their own connections; the offline queue must stay on so
    // subscriptions are (re)issued once Redis becomes reachable.
    const pub = redis.connect('io-pub');
    pub.options.enableOfflineQueue = true;
    // The subscriber waits for Redis however long it takes: a SUBSCRIBE that gave up during an
    // outage would never be re-issued, leaving this replica deaf to the others.
    const sub = pub.duplicate({ connectionName: 'astro-api-io-sub', maxRetriesPerRequest: null });
    sub.on('error', (err) => this.logger.warn(`redis(io-sub): ${err.message}`));
    // The adapter fires publish/subscribe without handling their promises; while Redis is down a
    // rejection would be unhandled and kill the process. Swallow + log instead — a lost realtime
    // event is covered by the web client's fallback polling.
    this.guard(pub, 'io-pub', ['publish']);
    this.guard(sub, 'io-sub', ['subscribe', 'psubscribe']);
    this.adapter = createAdapter(pub, sub);
  }

  private guard(client: Redis, name: string, methods: ('publish' | 'subscribe' | 'psubscribe')[]) {
    const target = client as unknown as Record<string, (...args: unknown[]) => unknown>;
    for (const method of methods) {
      const original = target[method].bind(client);
      target[method] = (...args: unknown[]) => {
        const result = original(...args);
        if (result instanceof Promise) {
          result.catch((err: Error) => this.logger.warn(`redis(${name}) ${method} failed: ${err.message}`));
        }
        return result;
      };
    }
  }

  createIOServer(port: number, options?: ServerOptions) {
    const server = super.createIOServer(port, options);
    if (this.adapter) server.adapter(this.adapter);
    return server;
  }
}

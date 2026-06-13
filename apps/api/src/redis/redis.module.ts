import { Global, Logger, Module, type Provider, type OnApplicationShutdown } from '@nestjs/common';
import { Inject, Injectable } from '@nestjs/common';
import { Redis, type RedisOptions } from 'ioredis';
import * as Sentry from '@sentry/node';

/** DI token for the cache/rate-limit/session Redis (allkeys-lru). */
export const REDIS_CACHE = 'REDIS_CACHE';
/** DI token for the BullMQ Redis (noeviction, AOF). */
export const REDIS_QUEUE = 'REDIS_QUEUE';

const logger = new Logger('RedisModule');

function baseOptions(url: string): RedisOptions {
  const isTls = url.startsWith('rediss://');
  return {
    lazyConnect: true,
    enableReadyCheck: true,
    // Never let a transient Redis error crash the process; log + report instead.
    retryStrategy: (times: number): number => Math.min(times * 200, 5000),
    reconnectOnError: (): boolean => true,
    ...(isTls ? { tls: {} } : {}),
  };
}

function createClient(url: string, name: string, options: RedisOptions): Redis {
  const client = new Redis(url, options);
  client.on('error', (error: Error) => {
    logger.error(`[${name}] redis error: ${error.message}`);
    Sentry.captureException(error, { tags: { component: 'redis', instance: name } });
  });
  client.on('ready', () => logger.log(`[${name}] connected`));
  return client;
}

const cacheProvider: Provider = {
  provide: REDIS_CACHE,
  useFactory: (): Redis => {
    const url = process.env.REDIS_CACHE_URL;
    if (!url) throw new Error('REDIS_CACHE_URL is not set');
    // Cache traffic: bounded per-request retries.
    return createClient(url, 'cache', { ...baseOptions(url), maxRetriesPerRequest: 3 });
  },
};

const queueProvider: Provider = {
  provide: REDIS_QUEUE,
  useFactory: (): Redis => {
    const url = process.env.REDIS_QUEUE_URL;
    if (!url) throw new Error('REDIS_QUEUE_URL is not set');
    // BullMQ v5 REQUIRES maxRetriesPerRequest: null on its connection (it manages
    // its own command retry semantics); this intentionally differs from cache.
    return createClient(url, 'queue', { ...baseOptions(url), maxRetriesPerRequest: null });
  },
};

/**
 * Disconnects both clients on shutdown so the process can exit cleanly.
 */
@Injectable()
export class RedisLifecycle implements OnApplicationShutdown {
  constructor(
    @Inject(REDIS_CACHE) private readonly cache: Redis,
    @Inject(REDIS_QUEUE) private readonly queue: Redis,
  ) {}

  async onApplicationShutdown(): Promise<void> {
    await Promise.allSettled([this.cache.quit(), this.queue.quit()]);
  }
}

@Global()
@Module({
  providers: [cacheProvider, queueProvider, RedisLifecycle],
  exports: [REDIS_CACHE, REDIS_QUEUE],
})
export class RedisModule {}

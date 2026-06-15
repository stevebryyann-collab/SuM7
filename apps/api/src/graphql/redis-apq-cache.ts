import type { Redis } from 'ioredis';

/**
 * Apollo's KeyValueCache contract (from @apollo/utils.keyvaluecache, a
 * transitive dependency not directly resolvable from this workspace). Declared
 * locally so the implementation is structurally compatible with what
 * ApolloDriverConfig.persistedQueries.cache expects, without a direct import.
 */
interface KeyValueCacheSetOptions {
  ttl?: number | null;
}
interface KeyValueCache<V = string> {
  get(key: string): Promise<V | undefined>;
  set(key: string, value: V, options?: KeyValueCacheSetOptions): Promise<void>;
  delete(key: string): Promise<boolean | void>;
}

/**
 * Apollo `KeyValueCache` backed by the existing REDIS_CACHE client (allkeys-lru).
 * Used as the Automatic Persisted Queries store: clients register a query by its
 * SHA-256 hash once, then send only the hash. In production arbitrary query
 * strings are rejected unless they were registered (see graphql.module).
 *
 * Keys are namespaced under `apollo:apq:` so APQ entries are easy to distinguish
 * from the application's own cache keys sharing the same Redis instance.
 */
export class RedisApqCache implements KeyValueCache<string> {
  private static readonly PREFIX = 'apollo:apq:';

  constructor(private readonly redis: Redis) {}

  async get(key: string): Promise<string | undefined> {
    const value = await this.redis.get(RedisApqCache.PREFIX + key);
    return value ?? undefined;
  }

  async set(key: string, value: string, options?: KeyValueCacheSetOptions): Promise<void> {
    const namespaced = RedisApqCache.PREFIX + key;
    if (options?.ttl != null && options.ttl > 0) {
      await this.redis.set(namespaced, value, 'EX', options.ttl);
    } else {
      await this.redis.set(namespaced, value);
    }
  }

  async delete(key: string): Promise<boolean> {
    const removed = await this.redis.del(RedisApqCache.PREFIX + key);
    return removed > 0;
  }
}

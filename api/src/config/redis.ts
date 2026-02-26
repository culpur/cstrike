/**
 * Redis client — caching, pub/sub, and session storage.
 */

import { Redis } from 'ioredis';
import { env } from './env.js';

export const redis = new Redis(env.REDIS_URL, {
  maxRetriesPerRequest: 3,
  retryStrategy(times: number) {
    const delay = Math.min(times * 200, 5000);
    return delay;
  },
  lazyConnect: true,
});

redis.on('error', (err: Error) => {
  console.error('[Redis] Connection error:', err.message);
});

redis.on('connect', () => {
  console.log('[Redis] Connected');
});

/**
 * Cache helper — get or set with TTL.
 */
export async function cached<T>(
  key: string,
  ttlSeconds: number,
  fetcher: () => Promise<T>,
): Promise<T> {
  const existing = await redis.get(key);
  if (existing) return JSON.parse(existing) as T;

  const value = await fetcher();
  await redis.setex(key, ttlSeconds, JSON.stringify(value));
  return value;
}

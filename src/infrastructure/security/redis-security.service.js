import crypto from 'node:crypto';
import { env } from '../../config/env.js';
import { createRedisConnection } from '../queue/bullmq-runtime.js';

const RATE_LIMIT_SCRIPT = `
local count = redis.call('INCR', KEYS[1])
if count == 1 then
  redis.call('EXPIRE', KEYS[1], ARGV[1])
end
return count
`;

function digest(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

/**
 * Redis-backed security primitives shared by every HTTP instance.
 * HMAC replay protection and rate limits deliberately use the same
 * connection so a Redis outage has one predictable failure mode.
 */
export class RedisSecurityService {
  constructor({
    url = env.REDIS_URL,
    namespace = 'aistickers:security',
    connectionFactory = createRedisConnection
  } = {}) {
    this.url = url;
    this.namespace = namespace;
    this.connectionFactory = connectionFactory;
    this.redis = null;
    this.connectionPromise = null;
  }

  async _getRedis() {
    if (this.redis && ['ready', 'connecting', 'connect'].includes(this.redis.status)) {
      return this.redis;
    }

    if (!this.connectionPromise) {
      let connection;
      this.connectionPromise = (async () => {
        connection = await this.connectionFactory(this.url, {
          lazyConnect: true,
          maxRetriesPerRequest: 1,
          enableReadyCheck: true,
          enableOfflineQueue: false,
          connectTimeout: 1000,
          retryStrategy: null
        });
        connection.on?.('error', () => {});
        if (connection.status === 'wait') await connection.connect();
        await connection.ping();
        this.redis = connection;
        return connection;
      })().catch(async error => {
        this.connectionPromise = null;
        if (connection) connection.disconnect();
        if (this.redis) {
          this.redis.disconnect();
          this.redis = null;
        }
        throw error;
      });
    }

    return this.connectionPromise;
  }

  async checkReady() {
    const redis = await this._getRedis();
    try {
      await redis.ping();
      return true;
    } catch (error) {
      await this._invalidate(redis);
      throw error;
    }
  }

  async consumeRateLimit({ scope, identity, limit, windowSeconds = env.RATE_LIMIT_WINDOW_SEC }) {
    const bucket = Math.floor(Date.now() / 1000 / windowSeconds);
    const key = `${this.namespace}:rate:${scope}:${digest(identity)}:${bucket}`;
    const redis = await this._getRedis();
    try {
      const count = Number(await redis.eval(RATE_LIMIT_SCRIPT, 1, key, String(windowSeconds)));
      const ttl = Math.max(Number(await redis.ttl(key)), 1);
      return {
        count,
        limit,
        remaining: Math.max(limit - count, 0),
        retryAfterSeconds: ttl
      };
    } catch (error) {
      await this._invalidate(redis);
      throw error;
    }
  }

  async claimNonce({ clientId, nonce, windowSeconds = env.SIG_WINDOW_SEC }) {
    const key = `${this.namespace}:nonce:${digest(`${clientId}:${nonce}`)}`;
    const redis = await this._getRedis();
    try {
      const result = await redis.set(key, '1', 'EX', windowSeconds, 'NX');
      return result === 'OK';
    } catch (error) {
      await this._invalidate(redis);
      throw error;
    }
  }

  async _invalidate(redis) {
    if (this.redis !== redis) return;
    this.redis = null;
    this.connectionPromise = null;
    redis.disconnect();
  }

  async close() {
    const redis = this.redis;
    this.redis = null;
    this.connectionPromise = null;
    if (!redis) return;
    try {
      await redis.quit();
    } catch {
      redis.disconnect();
    }
  }
}

export const redisSecurityService = new RedisSecurityService();

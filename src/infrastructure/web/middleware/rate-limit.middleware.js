import { env } from '../../../config/env.js';

function redisService(req) {
  return req.app.locals.redisSecurity;
}

function ipIdentity(req) {
  return req.ip || req.socket?.remoteAddress || 'unknown';
}

function userIdentity(req) {
  return req.user?.sub || null;
}

function tooManyRequests(res, retryAfterSeconds) {
  const retryAfter = Math.max(1, Math.ceil(retryAfterSeconds || 1));
  res.set('Retry-After', String(retryAfter));
  return res.status(429).json({
    error: 'Too many requests',
    message: 'Rate limit exceeded'
  });
}

function unavailable(res) {
  return res.status(503).json({
    error: 'Security service unavailable',
    message: 'Request temporarily unavailable'
  });
}

export function rateLimit({
  scope,
  limit,
  windowSeconds = env.RATE_LIMIT_WINDOW_SEC,
  identity = 'ip',
  failClosed = false
}) {
  return async (req, res, next) => {
    const value = identity === 'user' ? userIdentity(req) : ipIdentity(req);
    if (!value) return res.status(401).json({ error: 'Unauthorized' });

    try {
      const result = await redisService(req).consumeRateLimit({
        scope,
        identity: value,
        limit,
        windowSeconds
      });

      if (result.count > limit) {
        return tooManyRequests(res, result.retryAfterSeconds);
      }

      req.rateLimit = { scope, ...result };
      return next();
    } catch (error) {
      console.error(`[RateLimit:${scope}] Redis unavailable:`, error.message);
      if (failClosed) return unavailable(res);
      return next();
    }
  };
}

export const rateLimitIp = options => rateLimit({ ...options, identity: 'ip' });
export const rateLimitUser = options => rateLimit({ ...options, identity: 'user' });

/**
 * Active generation count is derived from the shared durable repository.
 * This prevents two app instances from each accepting two jobs for the same
 * user when PostgreSQL is the production source of truth.
 */
export function limitActiveGenerations({ limit = env.RATE_LIMIT_GENERATION_ACTIVE, retryAfterSeconds = env.RATE_LIMIT_WINDOW_SEC } = {}) {
  return async (req, res, next) => {
    const userId = userIdentity(req);
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    try {
      const repository = req.app.locals.container?.repositories?.generationJob;
      const jobs = await repository.findByUserId(userId);
      const active = jobs.filter(job => typeof job.isPending === 'function'
        ? job.isPending()
        : ['queued', 'processing'].includes(job.status)).length;

      if (active >= limit) {
        return tooManyRequests(res, retryAfterSeconds);
      }

      return next();
    } catch (error) {
      console.error('[RateLimit:generation-active] Repository unavailable:', error.message);
      return unavailable(res);
    }
  };
}

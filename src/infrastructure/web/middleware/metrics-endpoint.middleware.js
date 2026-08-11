import crypto from 'node:crypto';
import { metrics } from '../../observability/metrics.js';
import { env } from '../../../config/env.js';
import { getLogger } from '../../observability/logger.js';

const BEARER_PREFIX = 'Bearer ';

function timingSafeTokenEquals(provided, expected) {
  if (typeof provided !== 'string' || typeof expected !== 'string') return false;
  if (provided.length !== expected.length) return false;
  const providedBuf = Buffer.from(provided, 'utf8');
  const expectedBuf = Buffer.from(expected, 'utf8');
  if (providedBuf.length !== expectedBuf.length) return false;
  try {
    return crypto.timingSafeEqual(providedBuf, expectedBuf);
  } catch {
    return false;
  }
}

export async function metricsEndpointHandler(req, res) {
  if (!env.METRICS_ENABLED) {
    return res.status(404).json({ error: 'Not found' });
  }

  const auth = req.headers.authorization || '';
  if (!auth.startsWith(BEARER_PREFIX)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const token = auth.slice(BEARER_PREFIX.length);
  const expected = env.METRICS_BEARER_TOKEN || '';
  if (!token || !timingSafeTokenEquals(token, expected)) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  try {
    const queueProducer = req.app.locals.container?.services?.generationQueue;
    if (queueProducer) {
      const counts = await Promise.race([
        queueProducer.getMetrics(),
        new Promise((_, reject) => setTimeout(() => reject(new Error('queue metrics timeout')), 2000))
      ]);
      metrics.setQueueCounts('generation', counts);
      if (counts.cleanup) {
        metrics.setQueueCounts('cleanup', counts.cleanup);
      }
    }
  } catch (error) {
    getLogger().warn({ err: error }, 'failed to refresh queue metrics for scrape');
  }

  try {
    await Promise.race([
      metrics.collectDatabaseConnections(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('database metrics timeout')), 2000))
    ]);
  } catch (error) {
    getLogger().warn({ err: error }, 'failed to refresh database metrics for scrape');
  }

  res.setHeader('Content-Type', metrics.register.contentType);
  res.end(await metrics.register.metrics());
}

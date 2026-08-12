import { pingDatabase, disconnectPrisma, getPrismaClient } from '../persistence/prisma/client.js';
import { env } from '../../config/env.js';

function withTimeout(promise, timeoutMs, name) {
  let timer;
  const wrapped = Promise.resolve(promise).finally(() => clearTimeout(timer));
  return Promise.race([
    wrapped,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${name} health check timed out`)), timeoutMs);
    })
  ]);
}

export async function checkPostgres(timeoutMs = 2000) {
  if (!env.DATABASE_URL) {
    return { name: 'postgres', status: 'skipped' };
  }
  try {
    await withTimeout(pingDatabase(), timeoutMs, 'postgres');
    return { name: 'postgres', status: 'ok' };
  } catch {
    return { name: 'postgres', status: 'not ready' };
  }
}

export async function checkRedis(redisSecurity, timeoutMs = 2000) {
  if (!redisSecurity) {
    return { name: 'redis', status: 'not ready' };
  }
  try {
    await withTimeout(redisSecurity.checkReady(), timeoutMs, 'redis');
    return { name: 'redis', status: 'ok' };
  } catch {
    return { name: 'redis', status: 'not ready' };
  }
}

export async function checkStorage(storage, timeoutMs = 2000) {
  if (!storage) {
    return { name: 'storage', status: 'not ready' };
  }
  try {
    await withTimeout(storage.checkReady(), timeoutMs, 'storage');
    return { name: 'storage', status: 'ok' };
  } catch {
    return { name: 'storage', status: 'not ready' };
  }
}

export async function checkQueue(queueProducer, timeoutMs = 2000) {
  if (!env.GENERATION_QUEUE_ENABLED) {
    return { name: 'queue', status: 'skipped' };
  }
  if (!queueProducer) {
    return { name: 'queue', status: 'not ready' };
  }
  try {
    await withTimeout(queueProducer.getMetrics(), timeoutMs, 'queue');
    return { name: 'queue', status: 'ok' };
  } catch {
    return { name: 'queue', status: 'not ready' };
  }
}

export async function runReadinessChecks({
  redisSecurity,
  storage,
  queueProducer,
  timeoutMs = 2000,
  postgresTimeoutMs,
  redisTimeoutMs,
  storageTimeoutMs,
  queueTimeoutMs
}) {
  const [postgres, redis, store, queue] = await Promise.all([
    checkPostgres(postgresTimeoutMs ?? timeoutMs),
    checkRedis(redisSecurity, redisTimeoutMs ?? timeoutMs),
    checkStorage(storage, storageTimeoutMs ?? timeoutMs),
    checkQueue(queueProducer, queueTimeoutMs ?? timeoutMs)
  ]);
  const components = [postgres, redis, store, queue];
  const failed = components.filter(
    (c) => c.status === 'not ready' || c.status === 'error'
  );
  return {
    status: failed.length === 0 ? 'ready' : 'not ready',
    components,
    failed
  };
}

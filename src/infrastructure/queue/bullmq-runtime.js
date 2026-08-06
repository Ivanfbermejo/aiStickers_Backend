import { env } from '../../config/env.js';
import { createRequire } from 'node:module';

export const GENERATION_QUEUE_NAME = env.GENERATION_QUEUE_NAME || 'generation';
export const CLEANUP_QUEUE_NAME = env.CLEANUP_QUEUE_NAME || 'asset-cleanup';
export const GENERATION_DLQ_NAME = `${GENERATION_QUEUE_NAME}:dlq`;

let bullmqModule;
let redisModule;
const require = createRequire(import.meta.url);

async function loadBullMQ() {
  if (!bullmqModule) {
    try {
      bullmqModule = await import('bullmq');
    } catch (error) {
      try {
        bullmqModule = require('bullmq');
      } catch {
        throw error;
      }
    }
  }
  return bullmqModule;
}

async function loadRedis() {
  if (!redisModule) {
    try {
      redisModule = await import('ioredis');
    } catch (error) {
      try {
        redisModule = require('ioredis');
      } catch {
        throw error;
      }
    }
  }
  return redisModule.default || redisModule.Redis || redisModule;
}

export function redisConnectionOptions(url = env.REDIS_URL) {
  return {
    url,
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    connectTimeout: 5000,
    retryStrategy: attempts => Math.min(attempts * 250, 5000)
  };
}

export async function createRedisConnection(url = env.REDIS_URL) {
  const Redis = await loadRedis();
  const options = redisConnectionOptions(url);
  return new Redis(options.url, options);
}

export async function createBullMQQueue(name, config = env) {
  const { Queue } = await loadBullMQ();
  const connection = await createRedisConnection(config.REDIS_URL);
  const queue = new Queue(name, {
    connection,
    prefix: config.GENERATION_QUEUE_PREFIX,
    defaultJobOptions: {
      attempts: config.GENERATION_QUEUE_ATTEMPTS,
      backoff: {
        type: 'exponential',
        delay: config.GENERATION_QUEUE_BACKOFF_MS
      },
      removeOnComplete: { age: 86400, count: 1000 },
      // Failed jobs are retained until the DLQ/replay operator handles them.
      removeOnFail: false
    }
  });
  return { queue, connection };
}

export class GenerationQueueProducer {
  constructor({ config = env, queueFactory = createBullMQQueue } = {}) {
    this.config = config;
    this.queueFactory = queueFactory;
    this.queues = new Map();
    this.connections = new Set();
  }

  async queue(name) {
    if (!this.config.GENERATION_QUEUE_ENABLED) return null;
    if (!this.queues.has(name)) {
      const created = await this.queueFactory(name, this.config);
      const queue = created.queue || created;
      this.queues.set(name, queue);
      if (created.connection) this.connections.add(created.connection);
    }
    return this.queues.get(name);
  }

  async enqueueGeneration(jobId) {
    if (!jobId) throw new Error('Generation queue requires a PostgreSQL jobId');
    const queue = await this.queue(GENERATION_QUEUE_NAME);
    if (!queue) return { enqueued: false, disabled: true, jobId };

    const queued = await queue.add('generation', { jobId }, {
      // This is deliberately the database primary key. It is the only
      // idempotency key allowed for a generation queue entry.
      jobId,
      attempts: this.config.GENERATION_QUEUE_ATTEMPTS,
      backoff: { type: 'exponential', delay: this.config.GENERATION_QUEUE_BACKOFF_MS },
      removeOnComplete: { age: 86400, count: 1000 },
      removeOnFail: false
    });
    return { enqueued: true, jobId: queued.id };
  }

  async enqueueCleanup(task) {
    if (!task?.id) throw new Error('Cleanup queue requires a journal task id');
    const queue = await this.queue(CLEANUP_QUEUE_NAME);
    if (!queue) return { enqueued: false, disabled: true, taskId: task.id };
    const queued = await queue.add('asset-cleanup', { taskId: task.id }, {
      jobId: `cleanup:${task.id}`,
      attempts: this.config.GENERATION_QUEUE_ATTEMPTS,
      backoff: { type: 'exponential', delay: this.config.GENERATION_QUEUE_BACKOFF_MS },
      removeOnComplete: { age: 86400, count: 1000 },
      removeOnFail: false
    });
    return { enqueued: true, jobId: queued.id };
  }

  async enqueueDLQReplay(jobId) {
    const queue = await this.queue(GENERATION_QUEUE_NAME);
    if (!queue) throw new Error('Generation queue is disabled');
    return queue.add('generation', { jobId }, {
      jobId,
      attempts: this.config.GENERATION_QUEUE_ATTEMPTS,
      backoff: { type: 'exponential', delay: this.config.GENERATION_QUEUE_BACKOFF_MS },
      removeOnComplete: { age: 86400, count: 1000 },
      removeOnFail: false
    });
  }

  async scheduleMaintenance() {
    const generationQueue = await this.queue(GENERATION_QUEUE_NAME);
    const cleanupQueue = await this.queue(CLEANUP_QUEUE_NAME);
    if (!generationQueue || !cleanupQueue) return;

    await generationQueue.upsertJobScheduler(
      'generation-reconciler',
      { every: this.config.GENERATION_QUEUE_RECONCILE_INTERVAL_MS },
      { name: 'reconcile-generations', data: {} }
    );
    await cleanupQueue.upsertJobScheduler(
      'cleanup-reconciler',
      { every: this.config.GENERATION_QUEUE_RECONCILE_INTERVAL_MS },
      { name: 'reconcile-cleanup', data: {} }
    );
  }

  async getJobCounts() {
    const queue = await this.queue(GENERATION_QUEUE_NAME);
    if (!queue) return {};
    return queue.getJobCounts('wait', 'active', 'completed', 'failed', 'delayed', 'paused');
  }

  async close() {
    await Promise.all([...this.queues.values()].map(queue => queue.close().catch(() => {})));
    await Promise.all([...this.connections].map(connection => connection.quit().catch(() => connection.disconnect())));
    this.queues.clear();
    this.connections.clear();
  }
}

export async function loadBullMQClasses() {
  return loadBullMQ();
}

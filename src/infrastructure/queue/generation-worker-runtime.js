import { env } from '../../config/env.js';
import {
  CLEANUP_QUEUE_NAME,
  GENERATION_DLQ_NAME,
  GENERATION_QUEUE_NAME,
  createRedisConnection,
  loadBullMQClasses
} from './bullmq-runtime.js';

function withTimeout(promise, timeoutMs, message) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

export class GenerationQueueWorkerRuntime {
  constructor({ generationWorker, generationJobRepository, assetCleanupService, queueProducer, config = env }) {
    this.generationWorker = generationWorker;
    this.generationJobRepository = generationJobRepository;
    this.assetCleanupService = assetCleanupService;
    this.queueProducer = queueProducer;
    this.config = config;
    this.workers = [];
    this.events = [];
    this.connections = [];
    this.dlqQueue = null;
    this.metrics = { queued: 0, active: 0, failed: 0, stalled: 0 };
    this.started = false;
  }

  async start() {
    if (this.started) return;
    if (!this.config.GENERATION_QUEUE_ENABLED) {
      throw new Error('GENERATION_QUEUE_ENABLED must be true for worker:generation');
    }

    const { Worker, QueueEvents } = await loadBullMQClasses();
    const generationConnection = await createRedisConnection(this.config.REDIS_URL);
    const cleanupConnection = await createRedisConnection(this.config.REDIS_URL);
    const generationEventsConnection = await createRedisConnection(this.config.REDIS_URL);
    const cleanupEventsConnection = await createRedisConnection(this.config.REDIS_URL);
    this.connections.push(generationConnection, cleanupConnection, generationEventsConnection, cleanupEventsConnection);

    const workerOptions = {
      connection: generationConnection,
      prefix: this.config.GENERATION_QUEUE_PREFIX,
      concurrency: this.config.GENERATION_QUEUE_CONCURRENCY,
      lockDuration: this.config.GENERATION_QUEUE_LOCK_DURATION_MS,
      stalledInterval: this.config.GENERATION_QUEUE_STALLED_INTERVAL_MS,
      maxStalledCount: 2
    };
    const cleanupOptions = {
      connection: cleanupConnection,
      prefix: this.config.GENERATION_QUEUE_PREFIX,
      concurrency: this.config.CLEANUP_QUEUE_CONCURRENCY,
      lockDuration: this.config.GENERATION_QUEUE_LOCK_DURATION_MS,
      stalledInterval: this.config.GENERATION_QUEUE_STALLED_INTERVAL_MS,
      maxStalledCount: 2
    };

    const generationWorker = new Worker(
      GENERATION_QUEUE_NAME,
      job => withTimeout(this.processGenerationQueueJob(job), this.config.GENERATION_QUEUE_TIMEOUT_MS, 'Generation job timed out'),
      workerOptions
    );
    const cleanupWorker = new Worker(
      CLEANUP_QUEUE_NAME,
      job => withTimeout(this.processCleanupQueueJob(job), this.config.GENERATION_QUEUE_TIMEOUT_MS, 'Cleanup job timed out'),
      cleanupOptions
    );
    this.workers.push(generationWorker, cleanupWorker);

    const generationEvents = new QueueEvents(GENERATION_QUEUE_NAME, {
      connection: generationEventsConnection,
      prefix: this.config.GENERATION_QUEUE_PREFIX
    });
    const cleanupEvents = new QueueEvents(CLEANUP_QUEUE_NAME, {
      connection: cleanupEventsConnection,
      prefix: this.config.GENERATION_QUEUE_PREFIX
    });
    this.events.push(generationEvents, cleanupEvents);

    this.attachEvents(generationEvents, 'generation');
    this.attachEvents(cleanupEvents, 'cleanup');
    generationWorker.on('failed', (job, error) => this.onFailed(job, error).catch(failure => {
      console.error('[GenerationQueue] failed-event handler error:', failure.message);
    }));
    generationWorker.on('error', error => console.error('[GenerationQueue] worker error:', error.message));
    cleanupWorker.on('error', error => console.error('[CleanupQueue] worker error:', error.message));

    this.dlqQueue = await this.queueProducer.queue(GENERATION_DLQ_NAME);
    await this.queueProducer.scheduleMaintenance();
    await this.reconcileOnce();
    this.started = true;
    console.log(`[GenerationQueue] worker started (concurrency=${this.config.GENERATION_QUEUE_CONCURRENCY})`);
  }

  attachEvents(queueEvents, label) {
    queueEvents.on('waiting', () => { this.metrics.queued += 1; });
    queueEvents.on('active', () => { this.metrics.active += 1; });
    queueEvents.on('completed', () => { this.metrics.active = Math.max(0, this.metrics.active - 1); });
    queueEvents.on('failed', () => {
      this.metrics.active = Math.max(0, this.metrics.active - 1);
      this.metrics.failed += 1;
    });
    queueEvents.on('stalled', ({ jobId }) => {
      this.metrics.stalled += 1;
      console.warn(`[${label}Queue] stalled job ${jobId}`);
    });
  }

  async processGenerationQueueJob(job) {
    if (job.name === 'reconcile-generations') {
      await this.reconcileGenerationJobs();
      return { reconciled: true };
    }
    return this.generationWorker.processQueueJob(job);
  }

  async processCleanupQueueJob(job) {
    if (job.name === 'reconcile-cleanup') {
      await this.reconcileCleanupJobs();
      return { reconciled: true };
    }
    const taskId = job.data?.taskId;
    if (!taskId) throw new Error('Cleanup queue payload has no taskId');
    return this.assetCleanupService.process({ id: taskId });
  }

  async reconcileOnce() {
    await Promise.all([this.reconcileGenerationJobs(), this.reconcileCleanupJobs()]);
  }

  async reconcileGenerationJobs() {
    const jobs = await this.generationJobRepository.findRecoverable?.(100) || [];
    for (const job of jobs) {
      try {
        await this.queueProducer.enqueueGeneration(job.id);
      } catch (error) {
        console.error(`[GenerationQueue] reconciliation failed for ${job.id}:`, error.message);
      }
    }
  }

  async reconcileCleanupJobs() {
    const tasks = await this.assetCleanupService.findConfirmedPending(100);
    for (const task of tasks) {
      try {
        await this.queueProducer.enqueueCleanup(task);
        await this.assetCleanupService.markQueued(task);
      } catch (error) {
        console.error(`[CleanupQueue] reconciliation failed for ${task.id}:`, error.message);
      }
    }
  }

  async onFailed(job, error) {
    if (!job || job.name !== 'generation' || job.attemptsMade < (job.opts.attempts || this.config.GENERATION_QUEUE_ATTEMPTS)) return;
    const jobId = job.data?.jobId;
    if (!jobId) return;
    await this.generationWorker.moveToDlq(jobId);
    if (this.dlqQueue) {
      await this.dlqQueue.add('generation-dlq', {
        sourceJobId: jobId,
        reason: error?.message || 'retry budget exhausted'
      }, {
        jobId: `dlq:${jobId}`,
        removeOnFail: false
      });
    }
    console.error(`[GenerationQueue] job ${jobId} moved to DLQ after retries`);
  }

  async stop() {
    if (!this.started && this.workers.length === 0) return;
    const timeoutMs = this.config.GENERATION_QUEUE_SHUTDOWN_TIMEOUT_MS;
    const closeWorkers = Promise.all(this.workers.map(worker => worker.close(false)));
    try {
      await withTimeout(closeWorkers, timeoutMs, 'Generation worker graceful shutdown timed out');
    } catch (error) {
      console.error('[GenerationQueue] forcing worker shutdown:', error.message);
      await Promise.all(this.workers.map(worker => worker.close(true).catch(() => {})));
    }
    await Promise.all(this.events.map(event => event.close().catch(() => {})));
    await Promise.all(this.connections.map(connection => connection.quit().catch(() => connection.disconnect())));
    this.workers = [];
    this.events = [];
    this.connections = [];
    this.started = false;
  }
}

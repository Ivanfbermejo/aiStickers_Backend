import { env } from '../../config/env.js';
import {
  CLEANUP_QUEUE_NAME,
  GENERATION_DLQ_NAME,
  GENERATION_QUEUE_NAME,
  createRedisConnection,
  loadBullMQClasses
} from './bullmq-runtime.js';

export async function withAbortTimeout(operation, timeoutMs, message) {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort(new Error(message));
  }, timeoutMs);

  try {
    // Await the operation itself. A timeout aborts its I/O; it never detaches
    // a live promise that could overlap the next BullMQ delivery.
    const result = await operation(controller.signal);
    if (timedOut) {
      const error = new Error(message);
      error.code = 'PROVIDER_TIMEOUT';
      error.transient = true;
      throw error;
    }
    return result;
  } catch (error) {
    if (timedOut || controller.signal.aborted) {
      const timeoutError = new Error(message);
      timeoutError.code = 'PROVIDER_TIMEOUT';
      timeoutError.transient = true;
      throw timeoutError;
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
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
    this.pendingEventHandlers = new Set();
    this.dlqQueue = null;
    this.metrics = { queued: 0, active: 0, failed: 0, stalled: 0 };
    this.stalledEvents = 0;
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
      job => withAbortTimeout(
        signal => this.processGenerationQueueJob(job, { signal }),
        this.config.GENERATION_QUEUE_TIMEOUT_MS,
        'Generation job timed out'
      ),
      workerOptions
    );
    const cleanupWorker = new Worker(
      CLEANUP_QUEUE_NAME,
      job => withAbortTimeout(
        signal => this.processCleanupQueueJob(job, { signal }),
        this.config.GENERATION_QUEUE_TIMEOUT_MS,
        'Cleanup job timed out'
      ),
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
    generationWorker.on('failed', (job, error) => {
      const pending = this.onFailed(job, error).catch(failure => {
        console.error('[GenerationQueue] failed-event handler error:', failure.message);
      });
      this.pendingEventHandlers.add(pending);
      pending.finally(() => this.pendingEventHandlers.delete(pending)).catch(() => {});
    });
    generationWorker.on('error', error => console.error('[GenerationQueue] worker error:', error.message));
    cleanupWorker.on('error', error => console.error('[CleanupQueue] worker error:', error.message));

    this.dlqQueue = await this.queueProducer.queue(GENERATION_DLQ_NAME);
    await this.queueProducer.scheduleMaintenance();
    await this.reconcileOnce();
    this.started = true;
    await this.refreshMetrics();
    console.log(`[GenerationQueue] worker started (concurrency=${this.config.GENERATION_QUEUE_CONCURRENCY})`);
  }

  attachEvents(queueEvents, label) {
    queueEvents.on('waiting', () => this.refreshMetrics().catch(() => {}));
    queueEvents.on('active', () => this.refreshMetrics().catch(() => {}));
    queueEvents.on('completed', () => this.refreshMetrics().catch(() => {}));
    queueEvents.on('failed', () => this.refreshMetrics().catch(() => {}));
    queueEvents.on('stalled', ({ jobId }) => {
      this.stalledEvents += 1;
      this.metrics.stalled = this.stalledEvents;
      console.warn(`[${label}Queue] stalled job ${jobId}`);
    });
  }

  async processGenerationQueueJob(job, { signal } = {}) {
    let result;
    if (job.name === 'reconcile-generations') {
      await this.reconcileGenerationJobs();
      result = { reconciled: true };
    } else {
      result = await this.generationWorker.processQueueJob(job, { signal });
    }
    await this.enqueueDeadLetterResult(result);
    return result;
  }

  async processCleanupQueueJob(job, { signal } = {}) {
    if (job.name === 'reconcile-cleanup') {
      await this.reconcileCleanupJobs();
      return { reconciled: true };
    }
    const taskId = job.data?.taskId;
    if (!taskId) throw new Error('Cleanup queue payload has no taskId');
    return this.assetCleanupService.process({ id: taskId, signal });
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
    const result = await this.generationWorker.moveToDlq(jobId, error?.message || 'retry budget exhausted');
    await this.enqueueDeadLetterResult(result, error?.message || 'retry budget exhausted');
    console.error(`[GenerationQueue] job ${jobId} moved to DLQ after retries`);
  }

  async enqueueDeadLetterResult(result, fallbackReason = 'provider submission outcome is ambiguous') {
    if (!result?.deadLettered || !this.dlqQueue) return;
    await this.dlqQueue.add('generation-dlq', {
      sourceJobId: result.jobId,
      reason: result.reason || fallbackReason
    }, {
      jobId: `dlq-${result.jobId}`,
      removeOnFail: false
    });
  }

  async refreshMetrics() {
    const counts = await this.queueProducer.getMetrics();
    this.metrics = {
      queued: counts.queued,
      active: counts.active,
      failed: counts.failed,
      stalled: this.stalledEvents
    };
    return { ...this.metrics, cleanup: counts.cleanup };
  }

  async getMetrics() {
    return this.refreshMetrics();
  }

  async stop() {
    if (!this.started && this.workers.length === 0) return;
    const timeoutMs = this.config.GENERATION_QUEUE_SHUTDOWN_TIMEOUT_MS;
    let timedOut = false;
    const forceTimer = setTimeout(() => {
      timedOut = true;
      console.error('[GenerationQueue] forcing worker shutdown after drain timeout');
      for (const worker of this.workers) worker.close(true).catch(() => {});
    }, timeoutMs);
    await Promise.all(this.workers.map(worker => worker.close(false).catch(() => {})));
    clearTimeout(forceTimer);
    if (timedOut) console.error('[GenerationQueue] graceful shutdown exceeded timeout');
    await Promise.all([...this.pendingEventHandlers]);
    await Promise.all(this.events.map(event => event.close().catch(() => {})));
    await Promise.all(this.connections.map(connection => connection.quit().catch(() => connection.disconnect())));
    this.workers = [];
    this.events = [];
    this.connections = [];
    this.started = false;
  }
}

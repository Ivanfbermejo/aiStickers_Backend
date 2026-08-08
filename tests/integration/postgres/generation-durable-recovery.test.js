import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';

import { hasTestDatabase, getBaseDatabaseUrl, migrateDeploy } from '../../helpers/postgres.js';
import { PostgresGenerationJobRepository } from '../../../src/infrastructure/persistence/postgres/postgres-generation-job.repository.js';
import { PostgresStickerRepository } from '../../../src/infrastructure/persistence/postgres/postgres-sticker.repository.js';
import { PostgresBalanceRepository } from '../../../src/infrastructure/persistence/postgres/postgres-balance.repository.js';
import { PostgresTransactionRepository } from '../../../src/infrastructure/persistence/postgres/postgres-transaction.repository.js';
import { PostgresAssetCleanupTaskRepository } from '../../../src/infrastructure/persistence/postgres/postgres-asset-cleanup-task.repository.js';
import { PostgresUnitOfWork } from '../../../src/infrastructure/persistence/unit-of-work.js';
import { GenerationJobWorker } from '../../../src/infrastructure/ai/generation-job.worker.js';
import { ProviderError } from '../../../src/infrastructure/ai/provider-error.js';
import { AssetCleanupService } from '../../../src/application/services/asset-cleanup.service.js';
import { RefundBalanceUseCase } from '../../../src/application/use-cases/balance/refund-balance.use-case.js';
import { SpendBalanceUseCase } from '../../../src/application/use-cases/balance/spend-balance.use-case.js';
import { CostService } from '../../../src/application/services/cost.service.js';
import { CreateGenerationJobUseCase } from '../../../src/application/use-cases/generation/create-generation-job.use-case.js';
import { GenerationQueueProducer, createRedisConnection, loadBullMQClasses } from '../../../src/infrastructure/queue/bullmq-runtime.js';
import { GenerationQueueWorkerRuntime } from '../../../src/infrastructure/queue/generation-worker-runtime.js';

const hasRedis = typeof process.env.REDIS_URL === 'string' && process.env.REDIS_URL.trim() !== '';
const runIntegration = hasTestDatabase() && hasRedis;
const databaseUrl = process.env.T08_DATABASE_URL || getBaseDatabaseUrl();

describe.skipIf(!runIntegration)('T08 durable generation recovery (real PostgreSQL + Redis)', () => {
  let prisma;
  const users = new Set();

  beforeAll(async () => {
    await migrateDeploy(databaseUrl);
    prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    const Redis = (await import('ioredis')).default;
    const redis = new Redis(process.env.REDIS_URL);
    await redis.ping();
    await redis.quit();
  });

  afterAll(async () => {
    for (const userId of users) {
      await prisma.generationJob.deleteMany({ where: { userId } });
      await prisma.sticker.deleteMany({ where: { userId } });
      await prisma.ledgerEntry.deleteMany({ where: { userId } });
      await prisma.balance.deleteMany({ where: { userId } });
      await prisma.user.deleteMany({ where: { id: userId } });
    }
    await prisma.assetCleanupTask.deleteMany({});
    await prisma.$disconnect();
  });

  function config(prefix, overrides = {}) {
    return {
      REDIS_URL: process.env.REDIS_URL,
      GENERATION_QUEUE_ENABLED: true,
      GENERATION_QUEUE_PREFIX: prefix,
      GENERATION_QUEUE_CONCURRENCY: 2,
      CLEANUP_QUEUE_CONCURRENCY: 2,
      GENERATION_QUEUE_ATTEMPTS: 2,
      GENERATION_QUEUE_BACKOFF_MS: 5,
      GENERATION_QUEUE_TIMEOUT_MS: 2_000,
      GENERATION_QUEUE_LOCK_DURATION_MS: 10_000,
      GENERATION_QUEUE_STALLED_INTERVAL_MS: 1_000,
      GENERATION_QUEUE_RECONCILE_INTERVAL_MS: 60_000,
      GENERATION_QUEUE_SHUTDOWN_TIMEOUT_MS: 2_000,
      ...overrides
    };
  }

  async function createJob({ balance = 2 } = {}) {
    const user = await prisma.user.create({
      data: { email: `${randomUUID()}@t08.test`, name: 'T08 integration' }
    });
    users.add(user.id);
    await prisma.balance.create({ data: { userId: user.id, stickerDollars: balance } });
    const sticker = await prisma.sticker.create({
      data: { userId: user.id, name: 'T08 sticker', status: 'PROCESSING', cost: 1 }
    });
    const job = await prisma.generationJob.create({
      data: {
        userId: user.id,
        type: 'IMAGE_STICKER',
        stickerId: sticker.id,
        input: { objectKey: 'input.png', prompt: 'test' },
        provider: 'replicate',
        cost: 1
      }
    });
    return { userId: user.id, stickerId: sticker.id, jobId: job.id };
  }

  function makeRepositories(generationJobRepository = new PostgresGenerationJobRepository(prisma)) {
    return {
      generationJob: generationJobRepository,
      sticker: new PostgresStickerRepository(prisma),
      balance: new PostgresBalanceRepository(prisma),
      transaction: new PostgresTransactionRepository(prisma),
      assetCleanupTask: new PostgresAssetCleanupTaskRepository(prisma)
    };
  }

  function makeAssetService() {
    return {
      getSignedUrl: async key => `https://private.test/${key}?expires=${Date.now() + 1000}`,
      copyExternalToStorage: async ({ signal }) => {
        if (signal?.aborted) throw new ProviderError('copy aborted', { code: 'PROVIDER_TIMEOUT' });
        return {
          key: `results/${randomUUID()}.png`,
          hash: 'a'.repeat(64),
          sizeBytes: 128,
          mimeType: 'image/png',
          width: 32,
          height: 32
        };
      }
    };
  }

  function makeWorker({ generationJobRepository, provider, assetService = makeAssetService(), refund = true, queueTimeoutMs = 2_000 }) {
    const repositories = makeRepositories(generationJobRepository);
    const refundBalanceUseCase = refund
      ? new RefundBalanceUseCase({
        balanceRepository: repositories.balance,
        transactionRepository: repositories.transaction,
        unitOfWork: new PostgresUnitOfWork({ balance: repositories.balance, transaction: repositories.transaction })
      })
      : null;
    return new GenerationJobWorker({
      generationJobRepository,
      stickerRepository: repositories.sticker,
      imageProvider: provider,
      animationProvider: provider,
      assetService,
      refundBalanceUseCase,
      queueTimeoutMs,
      lockDurationMs: 10_000
    });
  }

  async function startRuntime({ worker, prefix, timeoutMs = 2_000 }) {
    const runtimeConfig = config(prefix, { GENERATION_QUEUE_TIMEOUT_MS: timeoutMs });
    const queueProducer = new GenerationQueueProducer({ config: runtimeConfig });
    const runtime = new GenerationQueueWorkerRuntime({
      generationWorker: worker,
      generationJobRepository: worker.generationJobRepository,
      assetCleanupService: new AssetCleanupService({
        assetService: makeAssetService(),
        taskRepository: new PostgresAssetCleanupTaskRepository(prisma),
        queue: queueProducer
      }),
      queueProducer,
      config: runtimeConfig
    });
    await runtime.start();
    return { runtime, queueProducer, runtimeConfig };
  }

  async function waitForQueueEvent(queueProducer, prefix, jobId, attempts = 2) {
    const { QueueEvents } = await loadBullMQClasses();
    const connection = await createRedisConnection(process.env.REDIS_URL);
    const queue = await queueProducer.queue('generation');
    const events = new QueueEvents('generation', { connection, prefix });
    await events.waitUntilReady();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error(`Timed out waiting for BullMQ job ${jobId}`));
      }, 10_000);
      const cleanup = () => {
        clearTimeout(timer);
        events.removeAllListeners('completed');
        events.removeAllListeners('failed');
        events.close().catch(() => {});
        connection.quit().catch(() => connection.disconnect());
      };
      events.on('completed', data => {
        if (data.jobId !== jobId) return;
        cleanup();
        resolve({ state: 'completed', data });
      });
      events.on('failed', async data => {
        if (data.jobId !== jobId) return;
        const failedJob = await queue.getJob(jobId);
        if ((failedJob?.attemptsMade ?? 0) < attempts) return;
        cleanup();
        resolve({ state: 'failed', data });
      });
    });
  }

  async function enqueueAndWait(queueProducer, prefix, jobId, attempts = queueProducer.config.GENERATION_QUEUE_ATTEMPTS) {
    const eventPromise = waitForQueueEvent(queueProducer, prefix, jobId, attempts);
    await queueProducer.enqueueGeneration(jobId);
    return eventPromise;
  }

  async function waitUntil(predicate, timeoutMs = 15_000) {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      if (await predicate()) return;
      await new Promise(resolve => setTimeout(resolve, 25));
    }
    throw new Error('Timed out waiting for database state');
  }

  it('does not POST again when the crash occurs after provider creation', async () => {
    const fixture = await createJob();
    let createCalls = 0;
    class CrashAfterPostRepository extends PostgresGenerationJobRepository {
      async setProviderPredictionId() {
        throw new Error('simulated database crash after POST');
      }
    }
    const repository = new CrashAfterPostRepository(prisma);
    const worker = makeWorker({
      generationJobRepository: repository,
      provider: {
        createPrediction: async () => {
          createCalls += 1;
          return { providerPredictionId: 'pred-ambiguous' };
        },
        pollPrediction: async () => ({ imageUrl: 'https://external.test/result.png' })
      }
    });
    const prefix = `t08-ambiguous-${randomUUID()}`;
    const { runtime, queueProducer } = await startRuntime({ worker, prefix });
    try {
      await enqueueAndWait(queueProducer, prefix, fixture.jobId);
      const row = await prisma.generationJob.findUnique({ where: { id: fixture.jobId } });
      expect(createCalls).toBe(1);
      expect(row.currentStep).toBe('dead_letter');
      expect(row.status).toBe('FAILED');
      await worker.processQueueJob({ data: { jobId: fixture.jobId } });
      expect(createCalls).toBe(1);
    } finally {
      await runtime.stop();
      await queueProducer.close();
    }
  });

  it('recovers a processing failure by polling the persisted prediction', async () => {
    const fixture = await createJob();
    let createCalls = 0;
    let pollCalls = 0;
    const worker = makeWorker({
      generationJobRepository: new PostgresGenerationJobRepository(prisma),
      provider: {
        createPrediction: async () => ({ providerPredictionId: `pred-${++createCalls}` }),
        pollPrediction: async () => {
          pollCalls += 1;
          if (pollCalls === 1) throw new ProviderError('provider unavailable', { code: 'PROVIDER_NETWORK' });
          return { imageUrl: 'https://external.test/result.png' };
        }
      }
    });
    const prefix = `t08-recover-${randomUUID()}`;
    const { runtime, queueProducer } = await startRuntime({ worker, prefix });
    try {
      await enqueueAndWait(queueProducer, prefix, fixture.jobId);
      const row = await prisma.generationJob.findUnique({ where: { id: fixture.jobId } });
      expect(row.status).toBe('COMPLETED');
      expect(row.providerPredictionId).toBe('pred-1');
      expect(createCalls).toBe(1);
      expect(pollCalls).toBe(2);
    } finally {
      await runtime.stop();
      await queueProducer.close();
    }
  });

  it('uses the PostgreSQL claim so two workers do not duplicate a POST', async () => {
    const fixture = await createJob();
    let createCalls = 0;
    const provider = {
      createPrediction: async () => {
        createCalls += 1;
        await new Promise(resolve => setTimeout(resolve, 30));
        return { providerPredictionId: 'pred-one' };
      },
      pollPrediction: async () => ({ imageUrl: 'https://external.test/result.png' })
    };
    const prefix = `t08-two-workers-${randomUUID()}`;
    const first = await startRuntime({
      worker: makeWorker({ generationJobRepository: new PostgresGenerationJobRepository(prisma), provider }),
      prefix
    });
    const second = await startRuntime({
      worker: makeWorker({ generationJobRepository: new PostgresGenerationJobRepository(prisma), provider }),
      prefix
    });
    try {
      const queue = await first.queueProducer.queue('generation');
      await Promise.all([
        queue.add('generation', { jobId: fixture.jobId }, { jobId: `duplicate-a-${fixture.jobId}`, attempts: 2, backoff: { type: 'exponential', delay: 5 } }),
        queue.add('generation', { jobId: fixture.jobId }, { jobId: `duplicate-b-${fixture.jobId}`, attempts: 2, backoff: { type: 'exponential', delay: 5 } })
      ]);
      await waitUntil(async () => (await prisma.generationJob.findUnique({ where: { id: fixture.jobId } }))?.status === 'COMPLETED');
      const row = await prisma.generationJob.findUnique({ where: { id: fixture.jobId } });
      expect(row.status).toBe('COMPLETED');
      expect(createCalls).toBe(1);
    } finally {
      await first.runtime.stop();
      await second.runtime.stop();
      await first.queueProducer.close();
      await second.queueProducer.close();
    }
  }, 20_000);

  it('moves exhausted transient deliveries to DLQ without refunding', async () => {
    const fixture = await createJob({ balance: 1 });
    let createCalls = 0;
    const worker = makeWorker({
      generationJobRepository: new PostgresGenerationJobRepository(prisma),
      provider: {
        createPrediction: async () => ({ providerPredictionId: `pred-${++createCalls}` }),
        pollPrediction: async () => {
          throw new ProviderError('provider unavailable', { code: 'PROVIDER_NETWORK' });
        }
      }
    });
    const prefix = `t08-dlq-${randomUUID()}`;
    const { runtime, queueProducer } = await startRuntime({ worker, prefix });
    try {
      await enqueueAndWait(queueProducer, prefix, fixture.jobId, 2);
      await waitUntil(async () => (await prisma.generationJob.findUnique({ where: { id: fixture.jobId } }))?.currentStep === 'dead_letter');
      const balance = await prisma.balance.findUnique({ where: { userId: fixture.userId } });
      expect(createCalls).toBe(1);
      expect(balance.stickerDollars).toBe(1);
      expect(await prisma.ledgerEntry.count({ where: { userId: fixture.userId, type: 'REFUND' } })).toBe(0);
    } finally {
      await runtime.stop();
      await queueProducer.close();
    }
  }, 15_000);

  it('refunds a terminal failure once and never refunds transient exhaustion', async () => {
    const fixture = await createJob({ balance: 0 });
    const worker = makeWorker({
      generationJobRepository: new PostgresGenerationJobRepository(prisma),
      provider: {
        createPrediction: async () => ({ providerPredictionId: 'pred-terminal' }),
        pollPrediction: async () => {
          throw new ProviderError('bad input', { code: 'PROVIDER_HTTP_422', terminal: true, transient: false });
        }
      }
    });
    const prefix = `t08-refund-${randomUUID()}`;
    const { runtime, queueProducer } = await startRuntime({ worker, prefix });
    try {
      await enqueueAndWait(queueProducer, prefix, fixture.jobId);
      await worker.processQueueJob({ data: { jobId: fixture.jobId } });
      const balance = await prisma.balance.findUnique({ where: { userId: fixture.userId } });
      expect(balance.stickerDollars).toBe(1);
      expect(await prisma.ledgerEntry.count({ where: { userId: fixture.userId, type: 'REFUND' } })).toBe(1);
    } finally {
      await runtime.stop();
      await queueProducer.close();
    }
  });

  it('stores the asset before the external URL can expire', async () => {
    const fixture = await createJob();
    const worker = makeWorker({
      generationJobRepository: new PostgresGenerationJobRepository(prisma),
      provider: {
        createPrediction: async () => ({ providerPredictionId: 'pred-expiring-url' }),
        pollPrediction: async () => ({ imageUrl: 'https://external.test/expires-immediately.png' })
      }
    });
    const prefix = `t08-asset-${randomUUID()}`;
    const { runtime, queueProducer } = await startRuntime({ worker, prefix });
    try {
      await enqueueAndWait(queueProducer, prefix, fixture.jobId);
      const job = await prisma.generationJob.findUnique({ where: { id: fixture.jobId } });
      const sticker = await prisma.sticker.findUnique({ where: { id: fixture.stickerId } });
      expect(job.status).toBe('COMPLETED');
      expect(job.result.objectKey).toMatch(/^results\//);
      expect(job.result.imageUrl).toBeUndefined();
      expect(sticker.objectKey).toBe(job.result.objectKey);
      expect(sticker.imageUrl).toBeNull();
    } finally {
      await runtime.stop();
      await queueProducer.close();
    }
  });

  it('aborts a timed-out provider operation before the next delivery starts', async () => {
    const fixture = await createJob();
    let active = 0;
    let maxActive = 0;
    const worker = makeWorker({
      generationJobRepository: new PostgresGenerationJobRepository(prisma),
      queueTimeoutMs: 500,
      provider: {
        createPrediction: async () => ({ providerPredictionId: 'pred-timeout' }),
        pollPrediction: async (_id, { signal }) => new Promise((resolve, reject) => {
          if (signal.aborted) {
            reject(new ProviderError('timed out', { code: 'PROVIDER_TIMEOUT' }));
            return;
          }
          active += 1;
          maxActive = Math.max(maxActive, active);
          const finish = () => { active -= 1; reject(new ProviderError('timed out', { code: 'PROVIDER_TIMEOUT' })); };
          signal.addEventListener('abort', finish, { once: true });
        })
      }
    });
    const prefix = `t08-timeout-${randomUUID()}`;
    const { runtime, queueProducer } = await startRuntime({ worker, prefix, timeoutMs: 500 });
    try {
      await enqueueAndWait(queueProducer, prefix, fixture.jobId);
      await waitUntil(async () => (await prisma.generationJob.findUnique({ where: { id: fixture.jobId } }))?.currentStep === 'dead_letter', 10_000);
      expect(maxActive).toBe(1);
      expect(active).toBe(0);
    } finally {
      await runtime.stop();
      await queueProducer.close();
    }
  }, 15_000);

  it('rolls back the debit when sticker/job creation fails', async () => {
    const fixture = await createJob({ balance: 1 });
    class FailingGenerationJobRepository extends PostgresGenerationJobRepository {
      withPrisma(prismaClient) {
        const repository = new FailingGenerationJobRepository();
        repository.prisma = prismaClient;
        return repository;
      }

      async save() {
        throw new Error('simulated GenerationJob insert failure');
      }
    }
    const repositories = makeRepositories(new FailingGenerationJobRepository(prisma));
    const unitOfWork = new PostgresUnitOfWork(repositories);
    const spend = new SpendBalanceUseCase({
      balanceRepository: repositories.balance,
      transactionRepository: repositories.transaction,
      costService: new CostService(),
      unitOfWork
    });
    const useCase = new CreateGenerationJobUseCase({
      generationJobRepository: repositories.generationJob,
      stickerRepository: repositories.sticker,
      spendBalanceUseCase: spend,
      generationQueue: null,
      unitOfWork
    });

    await expect(useCase.execute({
      userId: fixture.userId,
      type: 'image_sticker',
      asset: { key: 'input.png' },
      prompt: 'rollback'
    })).rejects.toThrow('simulated GenerationJob insert failure');

    const balance = await prisma.balance.findUnique({ where: { userId: fixture.userId } });
    expect(balance.stickerDollars).toBe(1);
    expect(await prisma.generationJob.count({ where: { userId: fixture.userId } })).toBe(1);
    expect(await prisma.ledgerEntry.count({ where: { userId: fixture.userId, type: 'SPEND' } })).toBe(0);
  });

  it('claims cleanup atomically so concurrent workers do not lose the task', async () => {
    const repository = new PostgresAssetCleanupTaskRepository(prisma);
    let deleteCalls = 0;
    const assetService = {
      deleteIfOwned: async () => {
        deleteCalls += 1;
        await new Promise(resolve => setTimeout(resolve, 30));
        return { deleted: true };
      }
    };
    const first = new AssetCleanupService({ assetService, taskRepository: repository });
    const second = new AssetCleanupService({ assetService, taskRepository: new PostgresAssetCleanupTaskRepository(prisma) });
    const task = await first.schedule({ key: `cleanup-${randomUUID()}.png`, ownerId: 'cleanup-owner', entity: 'sticker:test' });
    await first.confirm(task);
    const results = await Promise.all([first.process(task), second.process(task)]);
    expect(results.filter(result => result.deleted).length).toBe(1);
    expect(results.some(result => result.reason === 'claimed_by_other_worker')).toBe(true);
    expect(deleteCalls).toBe(1);
    expect((await repository.findById(task.id)).status).toBe('completed');
  });

  it('reports queue counts from Redis rather than event deltas', async () => {
    const prefix = `t08-metrics-${randomUUID()}`;
    const configForMetrics = config(prefix);
    const producer = new GenerationQueueProducer({ config: configForMetrics });
    try {
      const metrics = await producer.getMetrics();
      expect(metrics).toEqual(expect.objectContaining({
        queued: expect.any(Number),
        active: expect.any(Number),
        failed: expect.any(Number),
        stalled: expect.any(Number)
      }));
    } finally {
      await producer.close();
    }
  });
});

import { PrismaClient } from '@prisma/client';
import { pathToFileURL } from 'node:url';

import { env } from '../src/config/env.js';
import {
  GENERATION_DLQ_NAME,
  GENERATION_QUEUE_NAME,
  createBullMQQueue
} from '../src/infrastructure/queue/bullmq-runtime.js';

const REPLAY_USAGE = 'Usage: npm run generation:dlq:replay -- <postgres-generation-job-id> [--provider-prediction-id <id> | --confirm-not-created]';
const REQUEUEABLE_STATES = new Set(['waiting', 'delayed', 'paused', 'waiting-children']);

export function parseReplayArgs(argv) {
  let sourceJobId;
  let providerPredictionId;
  let confirmNotCreated = false;

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--provider-prediction-id') {
      providerPredictionId = argv[++index];
      if (!providerPredictionId) throw new Error(`${REPLAY_USAGE}\n--provider-prediction-id requires a value`);
      continue;
    }
    if (argument === '--confirm-not-created') {
      confirmNotCreated = true;
      continue;
    }
    if (argument.startsWith('--')) throw new Error(`${REPLAY_USAGE}\nUnknown option: ${argument}`);
    if (sourceJobId) throw new Error(`${REPLAY_USAGE}\nOnly one generation job id is allowed`);
    sourceJobId = argument;
  }

  if (!sourceJobId) throw new Error(REPLAY_USAGE);
  if (providerPredictionId && confirmNotCreated) {
    throw new Error('Choose either --provider-prediction-id or --confirm-not-created, not both');
  }
  return { sourceJobId, providerPredictionId, confirmNotCreated };
}

function createReplayPrisma(config) {
  const databaseUrl = process.env.T08_DATABASE_URL || process.env.DATABASE_URL || config.DATABASE_URL;
  if (!databaseUrl) throw new Error('Replay requires DATABASE_URL or T08_DATABASE_URL');
  return new PrismaClient({ datasources: { db: { url: databaseUrl } } });
}

function replayMode(generationJob, { providerPredictionId, confirmNotCreated }) {
  if (generationJob.status === 'COMPLETED') {
    throw new Error(`Generation job ${generationJob.id} is already completed`);
  }
  if (providerPredictionId) {
    if (generationJob.providerPredictionId && generationJob.providerPredictionId !== providerPredictionId) {
      throw new Error(`Generation job ${generationJob.id} already has a different provider prediction id`);
    }
    return { mode: 'polling', providerPredictionId };
  }
  if (generationJob.providerPredictionId) {
    if (confirmNotCreated) {
      throw new Error(`Generation job ${generationJob.id} is not ambiguous: a provider prediction is already persisted`);
    }
    return { mode: 'polling', providerPredictionId: generationJob.providerPredictionId };
  }
  if (confirmNotCreated) return { mode: 'creation', providerPredictionId: null };
  throw new Error(
    `Ambiguous replay for ${generationJob.id}: choose --provider-prediction-id <id> to poll or --confirm-not-created to create`
  );
}

async function requeueGenerationJob(queue, sourceJobId, config) {
  const existing = await queue.getJob(sourceJobId);
  if (existing) {
    const state = await existing.getState();
    if (state === 'failed') {
      await existing.retry('failed');
      return { job: existing, action: 'retried' };
    }
    if (REQUEUEABLE_STATES.has(state)) return { job: existing, action: 'already-queued' };
    throw new Error(`Cannot replay generation job ${sourceJobId} while it is ${state}`);
  }

  const job = await queue.add('generation', { jobId: sourceJobId }, {
    jobId: sourceJobId,
    attempts: config.GENERATION_QUEUE_ATTEMPTS,
    backoff: { type: 'exponential', delay: config.GENERATION_QUEUE_BACKOFF_MS },
    removeOnComplete: { age: 86400, count: 1000 },
    removeOnFail: false
  });
  return { job, action: 'added' };
}

async function closeQueueHandle(handle) {
  if (handle?.queue) await handle.queue.close().catch(() => {});
  if (handle?.connection) await handle.connection.quit().catch(() => handle.connection.disconnect());
}

export async function replayGenerationDlq({
  sourceJobId,
  providerPredictionId,
  confirmNotCreated = false,
  config = env,
  prisma,
  queueFactory = createBullMQQueue
}) {
  const dlq = await queueFactory(GENERATION_DLQ_NAME, config);
  const generation = await queueFactory(GENERATION_QUEUE_NAME, config);
  const ownedPrisma = !prisma;
  let database = prisma;

  try {
    database ||= createReplayPrisma(config);
    const dlqJobId = `dlq-${sourceJobId}`;
    const dlqJob = await dlq.queue.getJob(dlqJobId);
    if (!dlqJob) throw new Error(`DLQ job not found: ${dlqJobId}`);

    const generationJob = await database.generationJob.findUnique({ where: { id: sourceJobId } });
    if (!generationJob) throw new Error(`PostgreSQL generation job not found: ${sourceJobId}`);
    const decision = replayMode(generationJob, { providerPredictionId, confirmNotCreated });

    await database.generationJob.update({
      where: { id: sourceJobId },
      data: {
        providerPredictionId: decision.providerPredictionId,
        status: 'PROCESSING',
        currentStep: 'queued'
      }
    });

    const requeued = await requeueGenerationJob(generation.queue, sourceJobId, config);
    await dlqJob.remove();
    return { sourceJobId, mode: decision.mode, action: requeued.action, jobId: requeued.job.id };
  } finally {
    await closeQueueHandle(dlq);
    await closeQueueHandle(generation);
    if (ownedPrisma && database) await database.$disconnect().catch(() => {});
  }
}

async function main() {
  const options = parseReplayArgs(process.argv.slice(2));
  const result = await replayGenerationDlq(options);
  console.log(`Replayed generation job ${result.sourceJobId} via ${result.mode}`);
}

const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  try {
    await main();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

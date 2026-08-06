import { env } from '../src/config/env.js';
import {
  GENERATION_DLQ_NAME,
  GENERATION_QUEUE_NAME,
  createBullMQQueue
} from '../src/infrastructure/queue/bullmq-runtime.js';

const sourceJobId = process.argv[2];
if (!sourceJobId) {
  console.error(`Usage: npm run generation:dlq:replay -- <postgres-generation-job-id>`);
  process.exit(1);
}

const dlq = await createBullMQQueue(GENERATION_DLQ_NAME, env);
const generation = await createBullMQQueue(GENERATION_QUEUE_NAME, env);
try {
  const dlqJob = await dlq.queue.getJob(`dlq:${sourceJobId}`);
  if (!dlqJob) throw new Error(`DLQ job not found: dlq:${sourceJobId}`);

  await generation.queue.add('generation', { jobId: sourceJobId }, {
    jobId: sourceJobId,
    attempts: env.GENERATION_QUEUE_ATTEMPTS,
    backoff: { type: 'exponential', delay: env.GENERATION_QUEUE_BACKOFF_MS },
    removeOnComplete: { age: 86400, count: 1000 },
    removeOnFail: false
  });
  console.log(`Replayed generation job ${sourceJobId}`);
} finally {
  await dlq.queue.close().catch(() => {});
  await generation.queue.close().catch(() => {});
  await dlq.connection.quit().catch(() => dlq.connection.disconnect());
  await generation.connection.quit().catch(() => generation.connection.disconnect());
}

import { container } from '../src/config/container.js';
import { env } from '../src/config/env.js';
import { disconnectPrisma } from '../src/infrastructure/persistence/prisma/client.js';
import { GenerationQueueWorkerRuntime } from '../src/infrastructure/queue/generation-worker-runtime.js';
import { getLogger, rootLogger } from '../src/infrastructure/observability/logger.js';
import { initErrorTracker } from '../src/infrastructure/observability/error-tracker.js';

let runtime;
let stopping = false;

async function shutdown(signal) {
  if (stopping) {
    rootLogger.info({ signal }, 'worker shutdown already in progress');
    return;
  }
  stopping = true;
  const logger = getLogger();
  logger.info({ signal }, 'generation worker received shutdown signal, draining');
  try {
    await runtime?.stop();
    await container.services.generationQueue?.close();
    await disconnectPrisma();
    logger.info('worker shutdown complete');
    process.exit(0);
  } catch (error) {
    logger.error({ err: error }, 'worker shutdown failed');
    process.exit(1);
  }
}

for (const signal of ['SIGTERM', 'SIGINT']) {
  process.once(signal, () => shutdown(signal).catch((error) => {
    rootLogger.error({ err: error }, 'worker shutdown handler failed');
    process.exit(1);
  }));
}

try {
  await initErrorTracker();
  await container.initialize();
  runtime = new GenerationQueueWorkerRuntime({
    generationWorker: container.services.generationJobWorker,
    generationJobRepository: container.repositories.generationJob,
    assetCleanupService: container.services.assetCleanup,
    queueProducer: container.services.generationQueue,
    config: env
  });
  await runtime.start();
} catch (error) {
  rootLogger.error({ err: error }, 'generation worker unable to start');
  await container.services.generationQueue?.close().catch(() => {});
  await disconnectPrisma().catch(() => {});
  process.exit(1);
}

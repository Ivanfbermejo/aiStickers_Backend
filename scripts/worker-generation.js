import { container } from '../src/config/container.js';
import { env } from '../src/config/env.js';
import { disconnectPrisma } from '../src/infrastructure/persistence/prisma/client.js';
import { GenerationQueueWorkerRuntime } from '../src/infrastructure/queue/generation-worker-runtime.js';

let runtime;
let stopping = false;

async function shutdown(signal) {
  if (stopping) return;
  stopping = true;
  console.log(`[GenerationQueue] received ${signal}; draining worker`);
  try {
    await runtime?.stop();
    await container.services.generationQueue?.close();
    await disconnectPrisma();
  } finally {
    process.exit(0);
  }
}

for (const signal of ['SIGTERM', 'SIGINT']) {
  process.once(signal, () => shutdown(signal).catch(error => {
    console.error('[GenerationQueue] shutdown failed:', error);
    process.exit(1);
  }));
}

try {
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
  console.error('[GenerationQueue] unable to start:', error);
  await container.services.generationQueue?.close().catch(() => {});
  await disconnectPrisma().catch(() => {});
  process.exit(1);
}

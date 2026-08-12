#!/usr/bin/env node
/**
 * aiStickers Backend
 * Production entry point. Application setup lives in src/server.js so that
 * tests can import createApp() without starting the HTTP server.
 */

import { startServer, stopServer } from './src/server.js';
import { rootLogger, getLogger } from './src/infrastructure/observability/logger.js';
import { initErrorTracker } from './src/infrastructure/observability/error-tracker.js';
import { env } from './src/config/env.js';

async function main() {
  await initErrorTracker();
  const started = await startServer();
  let shuttingDown = false;

  const gracefulShutdown = async (signal) => {
    if (shuttingDown) {
      rootLogger.info({ signal }, 'shutdown already in progress');
      return;
    }
    shuttingDown = true;
    rootLogger.info({ signal }, 'received shutdown signal, draining gracefully');
    const clean = await stopServer(started);
    if (clean) {
      rootLogger.info('shutdown complete');
      process.exit(0);
    } else {
      rootLogger.error('shutdown forced');
      process.exit(1);
    }
  };

  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
  process.on('SIGINT', () => gracefulShutdown('SIGINT'));
}

main().catch((err) => {
  rootLogger.error({ err }, 'failed to start server');
  process.exit(1);
});

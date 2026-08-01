#!/usr/bin/env node
/**
 * aiStickers Backend
 * Production entry point. Application setup lives in src/server.js so that
 * tests can import createApp() without starting the HTTP server.
 */

import { startServer, stopServer } from './src/server.js';

async function main() {
  const started = await startServer();

  const gracefulShutdown = async (signal) => {
    console.log(`Received ${signal}, shutting down gracefully...`);
    await stopServer(started);
    console.log('Shutdown complete');
    process.exit(0);
  };

  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
  process.on('SIGINT', () => gracefulShutdown('SIGINT'));
}

main().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});

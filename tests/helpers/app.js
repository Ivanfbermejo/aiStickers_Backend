import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import crypto from 'node:crypto';

/**
 * Build a fresh Express app against a temporary DATA_DIR.
 * Returns the Supertest agent, the container and a cleanup function.
 */
export async function buildTestApp({ securityNamespace } = {}) {
  const dataDir = mkdtempSync(join(tmpdir(), 'aistickers-test-'));
  process.env.DATA_DIR = dataDir;

  // Reset module cache so env.js/container.js pick up the new DATA_DIR.
  const { createApp } = await import('../../src/server.js');
  const { RedisSecurityService } = await import('../../src/infrastructure/security/redis-security.service.js');
  const { app, container } = await createApp();
  const redisSecurity = new RedisSecurityService({
    namespace: securityNamespace || `aistickers:test:${crypto.randomUUID()}`
  });
  app.locals.redisSecurity = redisSecurity;

  return {
    app,
    container,
    dataDir,
    cleanup: () => {
      void redisSecurity.close();
      rmSync(dataDir, { recursive: true, force: true });
    }
  };
}

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Build a fresh Express app against a temporary DATA_DIR.
 * Returns the Supertest agent, the container and a cleanup function.
 */
export async function buildTestApp() {
  const dataDir = mkdtempSync(join(tmpdir(), 'aistickers-test-'));
  process.env.DATA_DIR = dataDir;

  // Reset module cache so env.js/container.js pick up the new DATA_DIR.
  const { createApp } = await import('../../src/server.js');
  const { app, container } = await createApp();

  return {
    app,
    container,
    dataDir,
    cleanup: () => rmSync(dataDir, { recursive: true, force: true })
  };
}

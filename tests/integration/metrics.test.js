import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import supertest from 'supertest';
import { hasTestDatabase } from '../helpers/postgres.js';

async function buildApp(envOverrides, dataDir) {
  vi.resetModules();
  for (const [key, value] of Object.entries(envOverrides)) {
    process.env[key] = value;
  }
  process.env.DATA_DIR = dataDir;
  const { createApp } = await import('../../src/server.js');
  const { app } = await createApp();
  return supertest(app);
}

describe('/metrics endpoint', () => {
  let dataDir;

  beforeEach(() => {
    delete process.env.METRICS_ENABLED;
    delete process.env.METRICS_BEARER_TOKEN;
    dataDir = mkdtempSync(join(tmpdir(), 'metrics-test-'));
  });

  afterEach(() => {
    rmSync(dataDir, { recursive: true, force: true });
  });

  it('returns 404 when metrics are disabled', async () => {
    const request = await buildApp({
      NODE_ENV: 'test',
      GENERATION_QUEUE_ENABLED: 'false',
      METRICS_ENABLED: 'false'
    }, dataDir);
    const res = await request.get('/metrics');
    expect(res.status).toBe(404);
  }, 30000);

  it('requires bearer token when metrics are enabled', async () => {
    const request = await buildApp({
      NODE_ENV: 'test',
      GENERATION_QUEUE_ENABLED: 'false',
      METRICS_ENABLED: 'true',
      METRICS_BEARER_TOKEN: 'metrics-secret-token'
    }, dataDir);
    const noAuth = await request.get('/metrics');
    expect(noAuth.status).toBe(401);

    const badAuth = await request.get('/metrics').set('Authorization', 'Bearer wrong');
    expect(badAuth.status).toBe(403);

    const ok = await request.get('/metrics').set('Authorization', 'Bearer metrics-secret-token');
    expect(ok.status).toBe(200);
    expect(ok.text).toContain('http_requests_total');
  }, 30000);

  it('uses normalized route labels, not raw IDs', async () => {
    const request = await buildApp({
      NODE_ENV: 'test',
      GENERATION_QUEUE_ENABLED: 'false',
      METRICS_ENABLED: 'true',
      METRICS_BEARER_TOKEN: 'metrics-secret-token',
      ENABLE_TELEGRAM: 'false',
      ENABLE_WHATSAPP_EXPORT: 'false'
    }, dataDir);
    await request.get('/health/live');
    const res = await request.get('/metrics').set('Authorization', 'Bearer metrics-secret-token');
    expect(res.status).toBe(200);
    expect(res.text).not.toMatch(/route=".*[0-9a-f-]{36}.*/);
    expect(res.text).toContain('route="/health/live"');
  }, 30000);

  it('labels unregistered routes as unmatched and never uses the path', async () => {
    const request = await buildApp({
      NODE_ENV: 'test',
      GENERATION_QUEUE_ENABLED: 'false',
      METRICS_ENABLED: 'true',
      METRICS_BEARER_TOKEN: 'metrics-secret-token',
      ENABLE_TELEGRAM: 'false',
      ENABLE_WHATSAPP_EXPORT: 'false'
    }, dataDir);
    const unknownPath = '/not-a-real-route/123e4567-e89b-12d3-a456-426614174000';
    await request.get(unknownPath);
    const res = await request.get('/metrics').set('Authorization', 'Bearer metrics-secret-token');
    expect(res.status).toBe(200);
    expect(res.text).toContain('route="unmatched"');
    expect(res.text).not.toContain(`route="${unknownPath}"`);
  }, 30000);

  it('compares bearer token with timing-safe equality', async () => {
    const token = 'metrics-secret-token';
    const request = await buildApp({
      NODE_ENV: 'test',
      GENERATION_QUEUE_ENABLED: 'false',
      METRICS_ENABLED: 'true',
      METRICS_BEARER_TOKEN: token
    }, dataDir);

    const noAuth = await request.get('/metrics');
    expect(noAuth.status).toBe(401);

    const badAuth = await request.get('/metrics').set('Authorization', 'Bearer wrong');
    expect(badAuth.status).toBe(403);

    const wrongLength = await request.get('/metrics').set('Authorization', `Bearer ${token}x`);
    expect(wrongLength.status).toBe(403);

    const ok = await request.get('/metrics').set('Authorization', `Bearer ${token}`);
    expect(ok.status).toBe(200);
  }, 30000);

  it.skipIf(!hasTestDatabase())('reports live PostgreSQL connection states when DATABASE_URL is active', async () => {
    const request = await buildApp({
      NODE_ENV: 'test',
      DATABASE_URL: process.env.DATABASE_URL,
      GENERATION_QUEUE_ENABLED: 'false',
      METRICS_ENABLED: 'true',
      METRICS_BEARER_TOKEN: 'metrics-secret-token'
    }, dataDir);

    const res = await request.get('/metrics').set('Authorization', 'Bearer metrics-secret-token');
    expect(res.status).toBe(200);
    expect(res.text).toMatch(/db_connections_in_use\{[^}]*\}\s+\d+/);
    expect(res.text).toMatch(/db_connections_idle\{[^}]*\}\s+\d+/);

    const { disconnectPrisma } = await import('../../src/infrastructure/persistence/prisma/client.js');
    await disconnectPrisma();
  }, 30000);
});

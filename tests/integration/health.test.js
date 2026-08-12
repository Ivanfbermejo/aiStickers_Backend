import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import { buildTestApp } from '../helpers/app.js';

describe('Health endpoint', () => {
  let ctx;

  beforeEach(async () => {
    process.env.GENERATION_QUEUE_ENABLED = 'false';
    ctx = await buildTestApp();
    // Mock Redis/security as healthy for the base case.
    ctx.app.locals.redisSecurity = { checkReady: vi.fn().mockResolvedValue(true) };
  });

  afterEach(() => {
    ctx.cleanup();
    vi.clearAllTimers();
    vi.useRealTimers();
    delete process.env.GENERATION_QUEUE_ENABLED;
  });

  it('responds 200 with status ok', async () => {
    const res = await request(ctx.app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.timestamp).toBeTypeOf('string');
  });

  it('live endpoint responds 200 without touching dependencies', async () => {
    const res = await request(ctx.app).get('/health/live');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });

  it('ready endpoint returns component statuses without URLs or secrets', async () => {
    const res = await request(ctx.app).get('/health/ready');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ready');
    expect(Array.isArray(res.body.components)).toBe(true);
    for (const component of res.body.components) {
      expect(component).toHaveProperty('name');
      expect(component).toHaveProperty('status');
      expect(component).not.toHaveProperty('url');
      expect(component).not.toHaveProperty('host');
      expect(component).not.toHaveProperty('message');
    }
  });

  it('ready fails when Redis is unreachable', async () => {
    ctx.app.locals.redisSecurity.checkReady.mockRejectedValue(new Error('redis down'));
    const res = await request(ctx.app).get('/health/ready');
    expect(res.status).toBe(503);
    const redis = res.body.components.find((c) => c.name === 'redis');
    expect(redis.status).toBe('not ready');
  });

  it('ready fails when storage is unreachable', async () => {
    ctx.app.locals.container.services.assetStorage.checkReady = vi.fn().mockRejectedValue(new Error('storage down'));
    const res = await request(ctx.app).get('/health/ready');
    expect(res.status).toBe(503);
    const storage = res.body.components.find((c) => c.name === 'storage');
    expect(storage.status).toBe('not ready');
  });
});

describe('Independent readiness checks', () => {
  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it('checkPostgres returns skipped when DATABASE_URL is not set', async () => {
    vi.resetModules();
    process.env.DATABASE_URL = '';
    const { checkPostgres } = await import('../../src/infrastructure/observability/health-checks.js');
    const result = await checkPostgres();
    expect(result).toEqual({ name: 'postgres', status: 'skipped' });
  });

  it('checkRedis reports not ready when redis check hangs', async () => {
    vi.resetModules();
    process.env.GENERATION_QUEUE_ENABLED = 'false';
    const { checkRedis } = await import('../../src/infrastructure/observability/health-checks.js');
    const hangingRedis = { checkReady: () => new Promise(() => {}) };
    const result = await checkRedis(hangingRedis, 25);
    expect(result).toEqual({ name: 'redis', status: 'not ready' });
  });

  it('checkStorage reports not ready when storage check hangs', async () => {
    vi.resetModules();
    process.env.GENERATION_QUEUE_ENABLED = 'false';
    const { checkStorage } = await import('../../src/infrastructure/observability/health-checks.js');
    const hangingStorage = { checkReady: () => new Promise(() => {}) };
    const result = await checkStorage(hangingStorage, 25);
    expect(result).toEqual({ name: 'storage', status: 'not ready' });
  });

  it('checkQueue reports not ready when queue check hangs', async () => {
    vi.resetModules();
    process.env.GENERATION_QUEUE_ENABLED = 'true';
    const { checkQueue } = await import('../../src/infrastructure/observability/health-checks.js');
    const hangingQueue = { getMetrics: () => new Promise(() => {}) };
    const result = await checkQueue(hangingQueue, 25);
    expect(result).toEqual({ name: 'queue', status: 'not ready' });
  });

  it('runReadinessChecks supports per-component timeouts', async () => {
    vi.resetModules();
    process.env.GENERATION_QUEUE_ENABLED = 'false';
    const { runReadinessChecks } = await import('../../src/infrastructure/observability/health-checks.js');
    const hangingStorage = { checkReady: () => new Promise(() => {}) };
    const start = Date.now();
    const result = await runReadinessChecks({
      redisSecurity: { checkReady: () => Promise.resolve(true) },
      storage: hangingStorage,
      storageTimeoutMs: 25,
      timeoutMs: 25,
      queueProducer: null
    });
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(200);
    expect(result.status).toBe('not ready');
    const storageComponent = result.components.find((c) => c.name === 'storage');
    expect(storageComponent.status).toBe('not ready');
  });
});

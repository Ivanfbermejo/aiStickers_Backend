import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { buildTestApp } from '../helpers/app.js';

describe('Health endpoint', () => {
  let ctx;

  beforeEach(async () => {
    ctx = await buildTestApp();
  });

  afterEach(() => {
    ctx.cleanup();
  });

  it('responds 200 with status ok', async () => {
    const res = await request(ctx.app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.timestamp).toBeTypeOf('string');
  });

  it('live endpoint responds 200', async () => {
    const res = await request(ctx.app).get('/health/live');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });

  it('ready endpoint responds 200 when data dir is writable', async () => {
    const res = await request(ctx.app).get('/health/ready');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ready');
  });
});

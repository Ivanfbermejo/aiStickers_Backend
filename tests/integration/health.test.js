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
});

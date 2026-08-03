import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { buildTestApp } from '../helpers/app.js';
import { signRequest } from '../helpers/hmac.js';
import { makeUserAccessToken } from '../helpers/token.js';

const CLIENT_ID = process.env.CLIENT_ID;
const CLIENT_SECRET = process.env.CLIENT_SECRET;

function makeUserToken(sub = 'user@example.com') {
  return makeUserAccessToken(sub);
}

describe('Authentication guards', () => {
  let ctx;

  beforeEach(async () => {
    ctx = await buildTestApp();
  });

  afterEach(() => {
    ctx.cleanup();
  });

  it('rejects a private route without any auth headers', async () => {
    const res = await request(ctx.app).get('/api/v1/plans');
    expect(res.status).toBe(401);
  });

  it('rejects a private route with HMAC but no bearer token', async () => {
    const headers = signRequest({ method: 'GET', path: '/api/v1/plans', clientId: CLIENT_ID, clientSecret: CLIENT_SECRET });
    const res = await request(ctx.app).get('/api/v1/plans').set(headers);
    expect(res.status).toBe(401);
  });

  it('allows a private route with valid HMAC and user JWT', async () => {
    const headers = signRequest({ method: 'GET', path: '/api/v1/plans', clientId: CLIENT_ID, clientSecret: CLIENT_SECRET });
    const token = makeUserToken();
    const res = await request(ctx.app)
      .get('/api/v1/plans')
      .set(headers)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.plans)).toBe(true);
  });

  it('rejects /users/balance when the bearer token is missing', async () => {
    const headers = signRequest({ method: 'GET', path: '/api/v1/users/balance', clientId: CLIENT_ID, clientSecret: CLIENT_SECRET });
    const res = await request(ctx.app).get('/api/v1/users/balance').set(headers);
    expect(res.status).toBe(401);
  });
});

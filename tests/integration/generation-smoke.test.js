import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { buildTestApp } from '../helpers/app.js';
import { signRequest } from '../helpers/hmac.js';
import { makeUserAccessToken } from '../helpers/token.js';
import { Balance } from '../../src/domain/entities/balance.entity.js';

const CLIENT_ID = process.env.CLIENT_ID;
const CLIENT_SECRET = process.env.CLIENT_SECRET;

function makeUserToken(sub = 'user@example.com') {
  return makeUserAccessToken(sub);
}

async function seedBalance(container, userId, amount) {
  await container.repositories.balance.save(new Balance({ userId, stickerDollars: amount }));
}

describe('Generation smoke', () => {
  let ctx;
  let token;

  beforeEach(async () => {
    ctx = await buildTestApp();
    token = makeUserToken();
    await seedBalance(ctx.container, 'user@example.com', 10);
  });

  afterEach(() => {
    ctx.cleanup();
  });

  it('creates a generation job and retrieves it', async () => {
    const body = {
      type: 'image_sticker',
      imageUrl: 'https://example.com/input.png',
      prompt: 'test prompt'
    };
    const createHeaders = signRequest({
      method: 'POST',
      path: '/api/v1/generation',
      body,
      clientId: CLIENT_ID,
      clientSecret: CLIENT_SECRET
    });

    const createRes = await request(ctx.app)
      .post('/api/v1/generation')
      .set(createHeaders)
      .set('Authorization', `Bearer ${token}`)
      .send(body);

    expect(createRes.status).toBe(201);
    expect(createRes.body.success).toBe(true);
    expect(createRes.body.jobId).toBeTypeOf('string');

    const jobId = createRes.body.jobId;
    const getHeaders = signRequest({
      method: 'GET',
      path: `/api/v1/generation/${jobId}`,
      clientId: CLIENT_ID,
      clientSecret: CLIENT_SECRET
    });

    const getRes = await request(ctx.app)
      .get(`/api/v1/generation/${jobId}`)
      .set(getHeaders)
      .set('Authorization', `Bearer ${token}`);

    expect(getRes.status).toBe(200);
    expect(getRes.body.success).toBe(true);
    expect(getRes.body.job.id).toBe(jobId);
  });
});

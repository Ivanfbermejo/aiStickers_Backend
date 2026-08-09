import { beforeAll, afterAll, beforeEach, afterEach, describe, expect, it } from 'vitest';
import Redis from 'ioredis';
import request from 'supertest';
import sharp from 'sharp';
import { buildTestApp } from '../helpers/app.js';
import { signRequest } from '../helpers/hmac.js';
import { makeUserAccessToken } from '../helpers/token.js';
import { Balance } from '../../src/domain/entities/balance.entity.js';
import { GenerationJob } from '../../src/domain/entities/generation-job.entity.js';

const CLIENT_ID = process.env.CLIENT_ID;
const CLIENT_SECRET = process.env.CLIENT_SECRET;
const REDIS_URL = process.env.REDIS_URL || 'redis://127.0.0.1:6379';
const SECURITY_NAMESPACE = 'aistickers:t09';

let redis;

async function clearSecurityKeys() {
  const keys = await redis.keys(`${SECURITY_NAMESPACE}:*`);
  if (keys.length > 0) await redis.del(...keys);
}

function headers(path, options = {}) {
  return signRequest({
    method: options.method || 'GET',
    path,
    body: options.body,
    clientId: CLIENT_ID,
    clientSecret: CLIENT_SECRET,
    timestamp: options.timestamp,
    nonce: options.nonce,
    version: options.version
  });
}

describe.sequential('T09 rate limits and HMAC replay protection', () => {
  let ctx;

  beforeAll(async () => {
    redis = new Redis(REDIS_URL, { maxRetriesPerRequest: 1, connectTimeout: 1000 });
    await redis.ping();
  });

  afterAll(async () => {
    await redis.quit();
  });

  beforeEach(async () => {
    await clearSecurityKeys();
    ctx = await buildTestApp({ securityNamespace: SECURITY_NAMESPACE });
  });

  afterEach(() => {
    ctx.cleanup();
  });

  it('rejects a replayed nonce and malformed inputs without a 500', async () => {
    const token = makeUserAccessToken('replay@example.com');
    const replayHeaders = headers('/api/v1/plans');

    const first = await request(ctx.app)
      .get('/api/v1/plans')
      .set(replayHeaders)
      .set('Authorization', `Bearer ${token}`);
    const replay = await request(ctx.app)
      .get('/api/v1/plans')
      .set(replayHeaders)
      .set('Authorization', `Bearer ${token}`);

    expect(first.status).toBe(200);
    expect(replay.status).toBe(401);
    expect(replay.body.error).toBe('Replay detected');

    const malformedTimestamp = await request(ctx.app)
      .get('/api/v1/plans')
      .set(headers('/api/v1/plans', { timestamp: '12.5' }))
      .set('X-App-Signature', '0'.repeat(64))
      .set('Authorization', `Bearer ${token}`);
    const malformedNonce = await request(ctx.app)
      .get('/api/v1/plans')
      .set(headers('/api/v1/plans', { nonce: 'not-a-uuid' }))
      .set('Authorization', `Bearer ${token}`);
    const malformedSignature = await request(ctx.app)
      .get('/api/v1/plans')
      .set(headers('/api/v1/plans'))
      .set('X-App-Signature', 'not-hex')
      .set('Authorization', `Bearer ${token}`);

    expect(malformedTimestamp.status).toBe(401);
    expect(malformedNonce.status).toBe(401);
    expect(malformedSignature.status).toBe(401);

    const legacy = await request(ctx.app)
      .get('/api/v1/plans')
      .set(headers('/api/v1/plans', { version: '1' }))
      .set('Authorization', `Bearer ${token}`);
    expect(legacy.status).toBe(200);
  });

  it('keeps the app-token IP limit independent from user generation limits', async () => {
    for (let i = 0; i < 20; i += 1) {
      const res = await request(ctx.app)
        .post('/api/v1/auth/token')
        .set(headers('/api/v1/auth/token', { method: 'POST', body: {} }))
        .send({});
      expect(res.status).toBe(200);
    }

    const blockedToken = await request(ctx.app)
      .post('/api/v1/auth/token')
      .set(headers('/api/v1/auth/token', { method: 'POST', body: {} }))
      .send({});
    expect(blockedToken.status).toBe(429);
    expect(blockedToken.headers['retry-after']).toMatch(/^\d+$/);

    const userToken = makeUserAccessToken('independent@example.com');
    for (let i = 0; i < 5; i += 1) {
      const res = await request(ctx.app)
        .post('/api/v1/generation')
        .set(headers('/api/v1/generation', { method: 'POST', body: {} }))
        .set('Authorization', `Bearer ${userToken}`)
        .send({});
      expect(res.status).toBe(400);
    }

    const blockedGeneration = await request(ctx.app)
      .post('/api/v1/generation')
      .set(headers('/api/v1/generation', { method: 'POST', body: {} }))
      .set('Authorization', `Bearer ${userToken}`)
      .send({});
    expect(blockedGeneration.status).toBe(429);

    const otherUser = await request(ctx.app)
      .post('/api/v1/generation')
      .set(headers('/api/v1/generation', { method: 'POST', body: {} }))
      .set('Authorization', `Bearer ${makeUserAccessToken('other@example.com')}`)
      .send({});
    expect(otherUser.status).toBe(400);
  });

  it('enforces two active generation jobs from the shared repository', async () => {
    const userId = 'active@example.com';
    await ctx.container.repositories.generationJob.save(GenerationJob.create({
      userId,
      type: 'image_sticker',
      stickerId: 'sticker-1',
      input: {},
      provider: 'test'
    }));
    await ctx.container.repositories.generationJob.save(GenerationJob.create({
      userId,
      type: 'image_sticker',
      stickerId: 'sticker-2',
      input: {},
      provider: 'test'
    }));

    const res = await request(ctx.app)
      .post('/api/v1/generation')
      .set(headers('/api/v1/generation', { method: 'POST', body: {} }))
      .set('Authorization', `Bearer ${makeUserAccessToken(userId)}`)
      .send({});

    expect(res.status).toBe(429);
    expect(res.headers['retry-after']).toMatch(/^\d+$/);
  });

  it('accepts the v2 JSON objectKey and hash flow', async () => {
    const userId = 'object-v2@example.com';
    const image = await sharp({
      create: { width: 10, height: 10, channels: 3, background: 'green' }
    }).png().toBuffer();
    const stored = await ctx.container.services.asset.storeValidatedBuffer({
      buffer: image,
      ownerId: userId
    });
    await ctx.container.repositories.balance.save(new Balance({
      userId,
      stickerDollars: 10
    }));

    const body = {
      type: 'image_sticker',
      objectKey: stored.key,
      hash: stored.hash,
      prompt: 'v2 object request'
    };
    const res = await request(ctx.app)
      .post('/api/v1/generation')
      .set(headers('/api/v1/generation', { method: 'POST', body }))
      .set('Authorization', `Bearer ${makeUserAccessToken(userId)}`)
      .send(body);

    expect(res.status).toBe(201);
    const job = await ctx.container.repositories.generationJob.findById(res.body.jobId);
    expect(job.input).toMatchObject({ objectKey: stored.key, hash: stored.hash });
  });

  it('fails readiness and sensitive routes closed when Redis is unavailable', async () => {
    const { RedisSecurityService } = await import('../../src/infrastructure/security/redis-security.service.js');
    const unavailable = new RedisSecurityService({
      url: 'redis://127.0.0.1:6399',
      namespace: 'aistickers:t09:unavailable'
    });
    ctx.app.locals.redisSecurity = unavailable;

    const readiness = await request(ctx.app).get('/health/ready');
    const sensitive = await request(ctx.app)
      .post('/api/v1/generation')
      .set(headers('/api/v1/generation', { method: 'POST', body: {} }))
      .set('Authorization', `Bearer ${makeUserAccessToken('redis-down@example.com')}`)
      .send({});

    expect(readiness.status).toBe(503);
    expect(sensitive.status).toBe(503);
    expect(sensitive.body.error).toBe('Security service unavailable');
    await unavailable.close();
  });

  it('shares counters and nonce claims across two app instances', async () => {
    const second = await buildTestApp({ securityNamespace: SECURITY_NAMESPACE });
    try {
      for (let i = 0; i < 20; i += 1) {
        const res = await request(i % 2 === 0 ? ctx.app : second.app)
          .post('/api/v1/auth/token')
          .set(headers('/api/v1/auth/token', { method: 'POST', body: {} }))
          .send({});
        expect(res.status).toBe(200);
      }

      const sharedCounter = await request(second.app)
        .post('/api/v1/auth/token')
        .set(headers('/api/v1/auth/token', { method: 'POST', body: {} }))
        .send({});
      expect(sharedCounter.status).toBe(429);

      const nonce = '550e8400-e29b-41d4-a716-446655440000';
      const sharedNonce = headers('/api/v1/plans', { nonce });
      const first = await request(ctx.app)
        .get('/api/v1/plans')
        .set(sharedNonce)
        .set('Authorization', `Bearer ${makeUserAccessToken('instance-a@example.com')}`);
      const secondAttempt = await request(second.app)
        .get('/api/v1/plans')
        .set(sharedNonce)
        .set('Authorization', `Bearer ${makeUserAccessToken('instance-a@example.com')}`);

      expect(first.status).toBe(200);
      expect(secondAttempt.status).toBe(401);
    } finally {
      second.cleanup();
    }
  });
});

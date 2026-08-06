import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import sharp from 'sharp';
import { buildTestApp } from '../helpers/app.js';
import { signRequest } from '../helpers/hmac.js';
import { makeUserAccessToken } from '../helpers/token.js';

const CLIENT_ID = process.env.CLIENT_ID;
const CLIENT_SECRET = process.env.CLIENT_SECRET;

function makeUserToken(sub = 'user-a@example.com') {
  return makeUserAccessToken(sub);
}

async function makePngBuffer() {
  return sharp({
    create: { width: 10, height: 10, channels: 3, background: 'red' }
  })
    .png()
    .toBuffer();
}

describe('Private object storage', () => {
  let ctx;
  let tokenA;
  let tokenB;

  beforeEach(async () => {
    ctx = await buildTestApp();
    tokenA = makeUserToken('user-a@example.com');
    tokenB = makeUserToken('user-b@example.com');
  });

  afterEach(() => {
    ctx.cleanup();
  });

  it('serves a private asset to the owner with a signed URL', async () => {
    const asset = ctx.container.services.asset;
    const buffer = await makePngBuffer();
    const { key } = await asset.storeValidatedBuffer({ buffer, ownerId: 'user-a@example.com' });
    const signedUrl = await asset.getSignedUrl(key, 'user-a@example.com');
    const path = new URL(signedUrl, 'http://localhost').pathname;
    const token = new URL(signedUrl, 'http://localhost').searchParams.get('token');

    const res = await request(ctx.app).get(`${path}?token=${token}`);

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/image/);
    expect(Buffer.from(res.body).equals(buffer)).toBe(true);
  });

  it('denies access to another user without a token', async () => {
    const asset = ctx.container.services.asset;
    const buffer = await makePngBuffer();
    const { key } = await asset.storeValidatedBuffer({ buffer, ownerId: 'user-a@example.com' });

    const headers = signRequest({
      method: 'GET',
      path: `/api/v1/assets/${key}`,
      clientId: CLIENT_ID,
      clientSecret: CLIENT_SECRET
    });

    const res = await request(ctx.app)
      .get(`/api/v1/assets/${key}`)
      .set(headers)
      .set('Authorization', `Bearer ${tokenB}`);

    expect(res.status).toBe(403);
  });

  it('rejects an expired or invalid token', async () => {
    const asset = ctx.container.services.asset;
    const buffer = await makePngBuffer();
    const { key } = await asset.storeValidatedBuffer({ buffer, ownerId: 'user-a@example.com' });

    const res = await request(ctx.app).get(`/api/v1/assets/${key}?token=invalid-token`);
    expect(res.status).toBe(403);
  });

  it('does not expose uploads via express.static in production', async () => {
    const originalEnv = { ...process.env };
    try {
      await vi.resetModules();
      process.env.NODE_ENV = 'production';
      process.env.JWT_SECRET = 'test_jwt_secret_minimum_32_chars_long';
      process.env.CLIENT_SECRET = 'test_client_secret_minimum_32_chars';
      process.env.CLIENT_ID = 'ai-stickers-test';
      process.env.GOOGLE_PACKAGE_NAME = 'com.animatedsticker.aistickers';
      process.env.GOOGLE_CLIENT_ID = 'test-google-client-id';
      process.env.GOOGLE_CLIENT_SECRET = 'test-google-client-secret';
      process.env.REPLICATE_API_TOKEN = 'test-replicate-token';
      process.env.REPLICATE_MODEL = 'google/nano-banana';
      process.env.REPLICATE_IMG2VID_MODEL = 'bytedance/seedance-1-pro';
      process.env.GOOGLE_PLAY_SERVICE_ACCOUNT = JSON.stringify({ type: 'service_account' });
      process.env.DATABASE_URL = 'postgresql://user:pass@localhost:5432/aistickers';
      process.env.ASSET_STORAGE_DRIVER = 's3';
      process.env.ASSET_STORAGE_BUCKET = 'aistickers-private-assets';
      process.env.ASSET_STORAGE_REGION = 'us-east-1';
      process.env.ASSET_STORAGE_ACCESS_KEY_ID = 'test-access-key';
      process.env.ASSET_STORAGE_SECRET_ACCESS_KEY = 'test-secret-key';
      process.env.ASSET_STORAGE_ENDPOINT = 'http://localhost:9000';
      process.env.PERSISTENCE_DRIVER = 'postgres';

      const { createApp } = await import('../../src/server.js');
      const { app } = await createApp();

      const routes = app._router.stack
        .filter(layer => layer.name === 'serveStatic')
        .map(layer => layer.regexp.toString());
      expect(routes.some(route => route.includes('/uploads'))).toBe(false);
    } finally {
      Object.keys(process.env).forEach(k => delete process.env[k]);
      Object.assign(process.env, originalEnv);
      await vi.resetModules();
    }
  });
});

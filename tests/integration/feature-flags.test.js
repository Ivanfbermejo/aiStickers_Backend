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

describe('Feature flags', () => {
  let ctx;
  let token;

  beforeEach(async () => {
    ctx = await buildTestApp();
    token = makeUserToken();
  });

  afterEach(() => {
    ctx.cleanup();
  });

  it('public config reflects disabled flags and has no iOS placeholder', async () => {
    const headers = signRequest({ method: 'GET', path: '/api/v1/config', clientId: CLIENT_ID, clientSecret: CLIENT_SECRET });
    const res = await request(ctx.app).get('/api/v1/config').set(headers);

    expect(res.status).toBe(200);
    expect(res.body.features.appleAuth).toBe(false);
    expect(res.body.features.telegram).toBe(false);
    expect(res.body.features.whatsappExport).toBe(false);
    expect(res.body.features.externalImageUrls).toBe(false);
    expect(res.body.storeUrl).toHaveProperty('android');
    expect(res.body.storeUrl).not.toHaveProperty('ios');
  });

  it('returns 404 for disabled Apple payments route', async () => {
    const headers = signRequest({ method: 'POST', path: '/api/v1/payments/validate/apple-app-store', clientId: CLIENT_ID, clientSecret: CLIENT_SECRET });
    const res = await request(ctx.app)
      .post('/api/v1/payments/validate/apple-app-store')
      .set(headers)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(404);
  });

  it('returns 404 for disabled Telegram routes', async () => {
    const headers = signRequest({ method: 'POST', path: '/api/v1/telegram/export-pack', clientId: CLIENT_ID, clientSecret: CLIENT_SECRET });
    const res = await request(ctx.app)
      .post('/api/v1/telegram/export-pack')
      .set(headers)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(404);
  });

  it('returns 404 for disabled WhatsApp export routes', async () => {
    const headers = signRequest({ method: 'POST', path: '/api/v1/stickers/sticker-123/export/whatsapp', clientId: CLIENT_ID, clientSecret: CLIENT_SECRET });
    const res = await request(ctx.app)
      .post('/api/v1/stickers/sticker-123/export/whatsapp')
      .set(headers)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(404);
  });

  it('rejects external image URLs when the flag is disabled', async () => {
    await seedBalance(ctx.container, 'user@example.com', 10);
    const headers = signRequest({ method: 'POST', path: '/api/v1/ai/process-image', clientId: CLIENT_ID, clientSecret: CLIENT_SECRET });
    const res = await request(ctx.app)
      .post('/api/v1/ai/process-image')
      .set(headers)
      .set('Authorization', `Bearer ${token}`)
      .field('prompt', 'a sticker')
      .field('imageUrl', 'https://example.com/image.png');

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/External image URLs disabled/i);
  });

  it('rejects img2vid when external image URLs are disabled', async () => {
    await seedBalance(ctx.container, 'user@example.com', 10);
    const body = { imageUrl: 'https://example.com/image.png', prompt: 'test' };
    const headers = signRequest({ method: 'POST', path: '/api/v1/ai/img2vid', body, clientId: CLIENT_ID, clientSecret: CLIENT_SECRET });
    const res = await request(ctx.app)
      .post('/api/v1/ai/img2vid')
      .set(headers)
      .set('Authorization', `Bearer ${token}`)
      .send(body);

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/External image URLs disabled/i);
  });
});

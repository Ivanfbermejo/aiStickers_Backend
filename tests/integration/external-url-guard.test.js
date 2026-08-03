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

describe('External URL and upload hardening', () => {
  let ctx;
  let token;

  beforeEach(async () => {
    ctx = await buildTestApp();
    token = makeUserToken();
  });

  afterEach(() => {
    ctx.cleanup();
  });

  it('rejects an external imageUrl on the generation endpoint when disabled', async () => {
    await seedBalance(ctx.container, 'user@example.com', 10);
    const body = {
      type: 'image_sticker',
      imageUrl: 'https://example.com/input.png',
      prompt: 'test prompt'
    };
    const headers = signRequest({
      method: 'POST',
      path: '/api/v1/generation',
      body,
      clientId: CLIENT_ID,
      clientSecret: CLIENT_SECRET
    });

    const res = await request(ctx.app)
      .post('/api/v1/generation')
      .set(headers)
      .set('Authorization', `Bearer ${token}`)
      .send(body);

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/External image URLs disabled/i);
  });

  it('rejects an external imageUrl when creating a sticker manually', async () => {
    const body = {
      name: 'Test Sticker',
      imageUrl: 'https://example.com/sticker.png'
    };
    const headers = signRequest({
      method: 'POST',
      path: '/api/v1/stickers',
      body,
      clientId: CLIENT_ID,
      clientSecret: CLIENT_SECRET
    });

    const res = await request(ctx.app)
      .post('/api/v1/stickers')
      .set(headers)
      .set('Authorization', `Bearer ${token}`)
      .send(body);

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/External image URLs disabled/i);
  });

  it('rejects an uploaded file whose content is not a real image', async () => {
    await seedBalance(ctx.container, 'user@example.com', 10);
    const headers = signRequest({
      method: 'POST',
      path: '/api/v1/ai/process-image',
      clientId: CLIENT_ID,
      clientSecret: CLIENT_SECRET
    });

    // File claims to be PNG but contains random bytes.
    const res = await request(ctx.app)
      .post('/api/v1/ai/process-image')
      .set(headers)
      .set('Authorization', `Bearer ${token}`)
      .attach('image', Buffer.from('not a real png'), 'fake.png')
      .field('prompt', 'a sticker');

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Invalid uploaded image/i);
  });
});

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import sharp from 'sharp';

// WhatsApp export routes are only registered when ENABLE_WHATSAPP_EXPORT is
// true. Set this before server.js (and src/config/env.js) is ever imported.
process.env.ENABLE_WHATSAPP_EXPORT = 'true';

const { buildTestApp } = await import('../helpers/app.js');
const { signRequest } = await import('../helpers/hmac.js');
const { makeUserAccessToken } = await import('../helpers/token.js');

const CLIENT_ID = process.env.CLIENT_ID;
const CLIENT_SECRET = process.env.CLIENT_SECRET;

async function makePngDataUri() {
  const buffer = await sharp({
    create: { width: 10, height: 10, channels: 3, background: 'blue' }
  }).png().toBuffer();
  return `data:image/png;base64,${buffer.toString('base64')}`;
}

async function createPackageViaHttp(app, token, name) {
  const body = { name, isPublic: false, category: 'general' };
  const headers = signRequest({ method: 'POST', path: '/api/v1/packages', body, clientId: CLIENT_ID, clientSecret: CLIENT_SECRET });
  const res = await request(app).post('/api/v1/packages').set(headers).set('Authorization', `Bearer ${token}`).send(body);
  expect(res.status).toBe(201);
  return res.body.package;
}

async function createStickerViaHttp(app, token, { packageId, name = 'sticker' }) {
  const imageUrl = await makePngDataUri();
  const body = { name, imageUrl, packageId };
  const headers = signRequest({ method: 'POST', path: '/api/v1/stickers', body, clientId: CLIENT_ID, clientSecret: CLIENT_SECRET });
  const res = await request(app).post('/api/v1/stickers').set(headers).set('Authorization', `Bearer ${token}`).send(body);
  expect(res.status).toBe(201);
  return res.body.sticker;
}

describe('WhatsApp export cross-tenant authorization', () => {
  let ctx;
  let tokenA;
  let tokenB;
  const USER_A = 'whatsapp-owner@example.com';
  const USER_B = 'whatsapp-intruder@example.com';

  beforeEach(async () => {
    ctx = await buildTestApp();
    tokenA = makeUserAccessToken(USER_A);
    tokenB = makeUserAccessToken(USER_B);
  });

  afterEach(() => {
    ctx.cleanup();
  });

  it('POST export/whatsapp on a sticker owned by another user returns 404 without exporting', async () => {
    const pkg = await createPackageViaHttp(ctx.app, tokenA, 'A pack');
    const sticker = await createStickerViaHttp(ctx.app, tokenA, { packageId: pkg.id });

    const headers = signRequest({
      method: 'POST',
      path: `/api/v1/stickers/${sticker.id}/export/whatsapp`,
      clientId: CLIENT_ID,
      clientSecret: CLIENT_SECRET
    });
    const res = await request(ctx.app)
      .post(`/api/v1/stickers/${sticker.id}/export/whatsapp`)
      .set(headers)
      .set('Authorization', `Bearer ${tokenB}`);

    expect(res.status).toBe(404);

    const persisted = await ctx.container.repositories.sticker.findById(sticker.id, USER_A);
    expect(persisted.exportStatus).not.toBe('READY');
    expect(persisted.exportStatus).not.toBe('PROCESSING');
  });

  it('GET export/whatsapp status on a foreign sticker returns 404 without leaking data', async () => {
    const pkg = await createPackageViaHttp(ctx.app, tokenA, 'A pack 2');
    const sticker = await createStickerViaHttp(ctx.app, tokenA, { packageId: pkg.id });

    const headers = signRequest({
      method: 'GET',
      path: `/api/v1/stickers/${sticker.id}/export/whatsapp`,
      clientId: CLIENT_ID,
      clientSecret: CLIENT_SECRET
    });
    const res = await request(ctx.app)
      .get(`/api/v1/stickers/${sticker.id}/export/whatsapp`)
      .set(headers)
      .set('Authorization', `Bearer ${tokenB}`);

    expect(res.status).toBe(404);
  });

  it('POST package export/whatsapp on a package owned by another user returns 404 without exporting', async () => {
    const pkg = await createPackageViaHttp(ctx.app, tokenA, 'A pack 3');
    await createStickerViaHttp(ctx.app, tokenA, { packageId: pkg.id, name: 's1' });

    const headers = signRequest({
      method: 'POST',
      path: `/api/v1/packages/${pkg.id}/export/whatsapp`,
      clientId: CLIENT_ID,
      clientSecret: CLIENT_SECRET
    });
    const res = await request(ctx.app)
      .post(`/api/v1/packages/${pkg.id}/export/whatsapp`)
      .set(headers)
      .set('Authorization', `Bearer ${tokenB}`);

    expect(res.status).toBe(404);

    const persistedPkg = await ctx.container.repositories.package.findById(pkg.id, USER_A);
    expect(persistedPkg.exportStatus).not.toBe('READY');
  });

  it('GET package export/whatsapp status on a foreign package returns 404', async () => {
    const pkg = await createPackageViaHttp(ctx.app, tokenA, 'A pack 4');

    const headers = signRequest({
      method: 'GET',
      path: `/api/v1/packages/${pkg.id}/export/whatsapp`,
      clientId: CLIENT_ID,
      clientSecret: CLIENT_SECRET
    });
    const res = await request(ctx.app)
      .get(`/api/v1/packages/${pkg.id}/export/whatsapp`)
      .set(headers)
      .set('Authorization', `Bearer ${tokenB}`);

    expect(res.status).toBe(404);
  });
});

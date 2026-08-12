import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import sharp from 'sharp';
import { buildTestApp } from '../helpers/app.js';
import { signRequest } from '../helpers/hmac.js';
import { makeUserAccessToken } from '../helpers/token.js';
import { Balance } from '../../src/domain/entities/balance.entity.js';
import { Package } from '../../src/domain/entities/package.entity.js';
import { Sticker } from '../../src/domain/entities/sticker.entity.js';
import { GenerationJob } from '../../src/domain/entities/generation-job.entity.js';

const CLIENT_ID = process.env.CLIENT_ID;
const CLIENT_SECRET = process.env.CLIENT_SECRET;

const USER_A = 'user-a@example.com';
const USER_B = 'user-b@example.com';

function makeUserToken(sub) {
  return makeUserAccessToken(sub);
}

async function makePngDataUri() {
  const buffer = await sharp({
    create: { width: 10, height: 10, channels: 3, background: 'blue' }
  })
    .png()
    .toBuffer();
  return `data:image/png;base64,${buffer.toString('base64')}`;
}

async function seedBalance(container, userId, amount) {
  await container.repositories.balance.save(new Balance({ userId, stickerDollars: amount }));
}

async function createPackageViaHttp(app, token, name, isPublic = false) {
  const body = { name, isPublic, category: 'general' };
  const headers = signRequest({
    method: 'POST',
    path: '/api/v1/packages',
    body,
    clientId: CLIENT_ID,
    clientSecret: CLIENT_SECRET
  });
  const res = await request(app)
    .post('/api/v1/packages')
    .set(headers)
    .set('Authorization', `Bearer ${token}`)
    .send(body);
  expect(res.status).toBe(201);
  return res.body.package;
}

async function createStickerViaHttp(app, token, { packageId, name = 'sticker' }) {
  const imageUrl = await makePngDataUri();
  const body = { name, imageUrl, packageId };
  const headers = signRequest({
    method: 'POST',
    path: '/api/v1/stickers',
    body,
    clientId: CLIENT_ID,
    clientSecret: CLIENT_SECRET
  });
  const res = await request(app)
    .post('/api/v1/stickers')
    .set(headers)
    .set('Authorization', `Bearer ${token}`)
    .send(body);
  expect(res.status).toBe(201);
  return res.body.sticker;
}

describe('T10 cross-tenant HTTP authorization', () => {
  let ctx;
  let tokenA;
  let tokenB;

  beforeEach(async () => {
    ctx = await buildTestApp();
    tokenA = makeUserToken(USER_A);
    tokenB = makeUserToken(USER_B);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    ctx.cleanup();
  });

  describe('package A/B matrix', () => {
    it('GET returns 404 for user B on a package owned by user A', async () => {
      const pkg = await createPackageViaHttp(ctx.app, tokenA, 'A pack');
      const headers = signRequest({
        method: 'GET',
        path: `/api/v1/packages/${pkg.id}`,
        clientId: CLIENT_ID,
        clientSecret: CLIENT_SECRET
      });
      const res = await request(ctx.app)
        .get(`/api/v1/packages/${pkg.id}`)
        .set(headers)
        .set('Authorization', `Bearer ${tokenB}`);
      expect(res.status).toBe(404);
    });

    it('PUT returns 404 for user B on a package owned by user A', async () => {
      const pkg = await createPackageViaHttp(ctx.app, tokenA, 'A pack');
      const body = { name: 'Renamed by B' };
      const headers = signRequest({
        method: 'PUT',
        path: `/api/v1/packages/${pkg.id}`,
        body,
        clientId: CLIENT_ID,
        clientSecret: CLIENT_SECRET
      });
      const res = await request(ctx.app)
        .put(`/api/v1/packages/${pkg.id}`)
        .set(headers)
        .set('Authorization', `Bearer ${tokenB}`)
        .send(body);
      expect(res.status).toBe(404);
    });

    it('DELETE returns 404 for user B on a package owned by user A', async () => {
      const pkg = await createPackageViaHttp(ctx.app, tokenA, 'A pack');
      const headers = signRequest({
        method: 'DELETE',
        path: `/api/v1/packages/${pkg.id}`,
        clientId: CLIENT_ID,
        clientSecret: CLIENT_SECRET
      });
      const res = await request(ctx.app)
        .delete(`/api/v1/packages/${pkg.id}`)
        .set(headers)
        .set('Authorization', `Bearer ${tokenB}`);
      expect(res.status).toBe(404);
    });
  });

  describe('sticker A/B matrix', () => {
    it('GET returns 404 for user B on a sticker owned by user A', async () => {
      const pkg = await createPackageViaHttp(ctx.app, tokenA, 'A pack');
      const sticker = await createStickerViaHttp(ctx.app, tokenA, { packageId: pkg.id });
      const headers = signRequest({
        method: 'GET',
        path: `/api/v1/stickers/${sticker.id}`,
        clientId: CLIENT_ID,
        clientSecret: CLIENT_SECRET
      });
      const res = await request(ctx.app)
        .get(`/api/v1/stickers/${sticker.id}`)
        .set(headers)
        .set('Authorization', `Bearer ${tokenB}`);
      expect(res.status).toBe(404);
    });

    it('PUT returns 404 for user B on a sticker owned by user A', async () => {
      const pkg = await createPackageViaHttp(ctx.app, tokenA, 'A pack');
      const sticker = await createStickerViaHttp(ctx.app, tokenA, { packageId: pkg.id });
      const body = { name: 'Renamed by B' };
      const headers = signRequest({
        method: 'PUT',
        path: `/api/v1/stickers/${sticker.id}`,
        body,
        clientId: CLIENT_ID,
        clientSecret: CLIENT_SECRET
      });
      const res = await request(ctx.app)
        .put(`/api/v1/stickers/${sticker.id}`)
        .set(headers)
        .set('Authorization', `Bearer ${tokenB}`)
        .send(body);
      expect(res.status).toBe(404);
    });

    it('DELETE returns 404 for user B on a sticker owned by user A', async () => {
      const pkg = await createPackageViaHttp(ctx.app, tokenA, 'A pack');
      const sticker = await createStickerViaHttp(ctx.app, tokenA, { packageId: pkg.id });
      const headers = signRequest({
        method: 'DELETE',
        path: `/api/v1/stickers/${sticker.id}`,
        clientId: CLIENT_ID,
        clientSecret: CLIENT_SECRET
      });
      const res = await request(ctx.app)
        .delete(`/api/v1/stickers/${sticker.id}`)
        .set(headers)
        .set('Authorization', `Bearer ${tokenB}`);
      expect(res.status).toBe(404);
    });
  });

  describe('generation A/B matrix', () => {
    it('POST rejects a foreign package before charging user B', async () => {
      await seedBalance(ctx.container, USER_A, 10);
      const pkg = await createPackageViaHttp(ctx.app, tokenA, 'A pack');
      const imageUrl = await makePngDataUri();
      const body = { type: 'image_sticker', packageId: pkg.id, imageUrl, prompt: 'x' };
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
        .set('Authorization', `Bearer ${tokenB}`)
        .send(body);
      expect(res.status).toBe(404);
      expect(res.body.error).toMatch(/package|not found/i);
    });

    it('GET returns 404 for user B on a job owned by user A', async () => {
      const asset = await ctx.container.services.asset.ingestClientAsset({
        reference: await makePngDataUri(),
        ownerId: USER_A
      });
      const pkg = await ctx.container.repositories.package.save(Package.create({ userId: USER_A, name: 'A pack' }));
      const sticker = Sticker.createFromGeneration({ userId: USER_A, packageId: pkg.id, name: 's', prompt: 'x', cost: 1 });
      sticker.markAsStoredAsset(asset);
      await ctx.container.repositories.sticker.save(sticker);
      const job = GenerationJob.create({ userId: USER_A, type: 'image_sticker', packageId: pkg.id, stickerId: sticker.id, input: {} });
      await ctx.container.repositories.generationJob.save(job);

      const headers = signRequest({
        method: 'GET',
        path: `/api/v1/generation/${job.id}`,
        clientId: CLIENT_ID,
        clientSecret: CLIENT_SECRET
      });
      const res = await request(ctx.app)
        .get(`/api/v1/generation/${job.id}`)
        .set(headers)
        .set('Authorization', `Bearer ${tokenB}`);
      expect(res.status).toBe(404);
    });
  });

  describe('prediction status A/B', () => {
    it('does not call the provider when user B requests a foreign prediction id', async () => {
      const fetchSpy = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true })));
      vi.stubGlobal('fetch', fetchSpy);

      const job = GenerationJob.create({ userId: USER_A, type: 'image_sticker', stickerId: 'sticker-a', input: {} });
      job.setProviderPredictionId('prediction-a');
      await ctx.container.repositories.generationJob.save(job);

      const headers = signRequest({
        method: 'GET',
        path: '/api/v1/ai/status/prediction-a',
        clientId: CLIENT_ID,
        clientSecret: CLIENT_SECRET
      });
      const res = await request(ctx.app)
        .get('/api/v1/ai/status/prediction-a')
        .set(headers)
        .set('Authorization', `Bearer ${tokenB}`);
      expect(res.status).toBe(404);
      expect(fetchSpy).not.toHaveBeenCalled();
    });
  });

  describe('Telegram feature disabled', () => {
    it('export-pack returns 404 and does not require a bot token', async () => {
      const headers = signRequest({
        method: 'POST',
        path: '/api/v1/telegram/export-pack',
        body: {},
        clientId: CLIENT_ID,
        clientSecret: CLIENT_SECRET
      });
      const res = await request(ctx.app)
        .post('/api/v1/telegram/export-pack')
        .set(headers)
        .set('Authorization', `Bearer ${tokenB}`)
        .send({});
      expect(res.status).toBe(404);
    });

    it('reconcile-pack returns 404 and does not call Telegram', async () => {
      const fetchSpy = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true })));
      vi.stubGlobal('fetch', fetchSpy);
      const headers = signRequest({
        method: 'POST',
        path: '/api/v1/telegram/reconcile-pack',
        body: { package_id: 'pkg-1', sticker_ids_to_add: [] },
        clientId: CLIENT_ID,
        clientSecret: CLIENT_SECRET
      });
      const res = await request(ctx.app)
        .post('/api/v1/telegram/reconcile-pack')
        .set(headers)
        .set('Authorization', `Bearer ${tokenB}`)
        .send({ package_id: 'pkg-1', sticker_ids_to_add: [] });
      expect(res.status).toBe(404);
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('pack-status returns 404 and does not call Telegram', async () => {
      const fetchSpy = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true })));
      vi.stubGlobal('fetch', fetchSpy);
      const headers = signRequest({
        method: 'GET',
        path: '/api/v1/telegram/pack-status/foreign_set',
        clientId: CLIENT_ID,
        clientSecret: CLIENT_SECRET
      });
      const res = await request(ctx.app)
        .get('/api/v1/telegram/pack-status/foreign_set')
        .set(headers)
        .set('Authorization', `Bearer ${tokenB}`);
      expect(res.status).toBe(404);
      expect(fetchSpy).not.toHaveBeenCalled();
    });
  });

  describe('public package privacy', () => {
    it('does not expose private object keys or signed URLs to non-owners', async () => {
      const pkg = await createPackageViaHttp(ctx.app, tokenA, 'Public pack', true);
      const sticker = await createStickerViaHttp(ctx.app, tokenA, { packageId: pkg.id });

      // Add a tray icon object key directly so we can verify it is hidden.
      const stored = await ctx.container.services.asset.ingestClientAsset({
        reference: await makePngDataUri(),
        ownerId: USER_A
      });
      const full = await ctx.container.repositories.package.findById(pkg.id);
      full.trayIconObjectKey = stored.key;
      await ctx.container.repositories.package.update(full);

      const headers = signRequest({
        method: 'GET',
        path: `/api/v1/packages/${pkg.id}`,
        clientId: CLIENT_ID,
        clientSecret: CLIENT_SECRET
      });
      const res = await request(ctx.app)
        .get(`/api/v1/packages/${pkg.id}`)
        .set(headers)
        .set('Authorization', `Bearer ${tokenB}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.package.isPublic).toBe(true);
      expect(res.body.package).not.toHaveProperty('trayIconObjectKey');
      expect(res.body.package).not.toHaveProperty('trayIconObjectHash');
      const stickerOut = res.body.package.stickers.find(s => s.id === sticker.id);
      expect(stickerOut).toBeDefined();
      expect(stickerOut).not.toHaveProperty('objectKey');
      expect(stickerOut).not.toHaveProperty('objectHash');
      expect(stickerOut).not.toHaveProperty('whatsappObjectKey');
    });
  });
});

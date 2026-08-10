import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import crypto from 'node:crypto';
import request from 'supertest';
import sharp from 'sharp';

// Telegram routes are only registered when ENABLE_TELEGRAM is true. This must
// be set before server.js (and therefore src/config/env.js) is ever imported,
// which happens lazily inside buildTestApp() — so setting it here, after the
// static imports above but before any test runs, is sufficient.
process.env.ENABLE_TELEGRAM = 'true';

const { buildTestApp } = await import('../helpers/app.js');
const { signRequest } = await import('../helpers/hmac.js');
const { makeUserAccessToken } = await import('../helpers/token.js');
const { TelegramPackLink } = await import('../../src/domain/entities/telegram-pack-link.entity.js');

const CLIENT_ID = process.env.CLIENT_ID;
const CLIENT_SECRET = process.env.CLIENT_SECRET;
const BOT_USERNAME = 'testbot';

// Mirrors TelegramService.deriveSetName. Reimplemented locally so this test
// file never imports src/config/env.js before buildTestApp() sets a
// per-test DATA_DIR — importing telegram.service.js at module scope would
// cache the wrong (default) DATA_DIR for the whole file.
function deriveSetName({ packageId, botUsername }) {
  const sanitize = value => String(value).replace(/[^a-zA-Z0-9_]/g, '').slice(0, 28) || 'pack';
  return `aistickers_${sanitize(packageId)}_by_${sanitize(botUsername).replace(/^@/, '')}`.slice(0, 64);
}

function telegramResponse(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function getMeResponse() {
  return telegramResponse({ ok: true, result: { username: BOT_USERNAME } });
}

function createSetOkResponse() {
  return telegramResponse({ ok: true, result: true });
}

function createSetNameOccupiedResponse() {
  return telegramResponse({ ok: false, error_code: 400, description: 'Bad Request: sticker set name is already occupied' }, 400);
}

function getSetNotFoundResponse() {
  return telegramResponse({ ok: false, error_code: 400, description: 'Bad Request: STICKERSET_INVALID' }, 400);
}

function getSetOkResponse(setName, fileIds) {
  return telegramResponse({
    ok: true,
    result: { name: setName, title: 'title', stickers: fileIds.map(fileId => ({ file_id: fileId })) }
  });
}

function getSetServerErrorResponse() {
  return telegramResponse({ ok: false, error_code: 500, description: 'Internal Server Error' }, 500);
}

function getSetRateLimitedResponse() {
  return telegramResponse({ ok: false, error_code: 429, description: 'Too Many Requests: retry after 1' }, 429);
}

function queueFetch(...responses) {
  const queue = [...responses];
  const fetchSpy = vi.fn(() => {
    const next = queue.shift();
    if (!next) throw new Error('Unexpected extra Telegram API call');
    if (next instanceof Error) return Promise.reject(next);
    return Promise.resolve(next);
  });
  vi.stubGlobal('fetch', fetchSpy);
  return fetchSpy;
}

function signTelegramAuth(payload) {
  const dataCheckString = Object.entries(payload)
    .filter(([key]) => key !== 'hash')
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');
  const secretKey = crypto.createHash('sha256').update(process.env.TELEGRAM_BOT_TOKEN).digest();
  const hash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');
  return { ...payload, hash };
}

function telegramAuthFor(telegramUserId) {
  return signTelegramAuth({
    id: Number(telegramUserId),
    auth_date: Math.floor(Date.now() / 1000),
    username: 'tguser'
  });
}

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

function exportPackRequest(app, token, { packageId, stickerIds, telegramUserId }) {
  const body = { package_id: packageId, sticker_ids: stickerIds, telegram_auth: telegramAuthFor(telegramUserId) };
  const headers = signRequest({ method: 'POST', path: '/api/v1/telegram/export-pack', body, clientId: CLIENT_ID, clientSecret: CLIENT_SECRET });
  return request(app).post('/api/v1/telegram/export-pack').set(headers).set('Authorization', `Bearer ${token}`).send(body);
}

describe('Telegram export-pack recovery', () => {
  let ctx;
  let token;
  const userId = 'telegram-user@example.com';
  const telegramUserId = '555000111';

  beforeEach(async () => {
    ctx = await buildTestApp();
    token = makeUserAccessToken(userId);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    ctx.cleanup();
  });

  it('recovers a PENDING link when create succeeded remotely but the confirmation call had previously failed', async () => {
    const pkg = await createPackageViaHttp(ctx.app, token, 'Pack A');
    const sticker = await createStickerViaHttp(ctx.app, token, { packageId: pkg.id });
    const setName = deriveSetName({ packageId: pkg.id, botUsername: BOT_USERNAME });

    const link = TelegramPackLink.create({
      userId,
      telegramUserId,
      packageId: pkg.id,
      setName,
      stickerIdOrder: [sticker.id]
    });
    await ctx.container.repositories.telegramPackLink.save(link);
    expect(link.status).toBe('pending');

    const fetchSpy = queueFetch(getMeResponse(), getSetOkResponse(setName, ['file_1']));

    const res = await exportPackRequest(ctx.app, token, { packageId: pkg.id, stickerIds: [sticker.id], telegramUserId });

    expect(res.status).toBe(200);
    expect(res.body.set_name).toBe(setName);
    expect(res.body.sticker_count).toBe(1);
    // Only getMe + getStickerSet were called; createNewStickerSet must not run.
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(fetchSpy.mock.calls.some(([url]) => String(url).includes('createNewStickerSet'))).toBe(false);

    const persisted = await ctx.container.repositories.telegramPackLink.findByUserIdAndPackageId(userId, pkg.id);
    expect(persisted.status).toBe('active');
    expect(persisted.stickerFileIds).toEqual({ [sticker.id]: 'file_1' });
  });

  it('recovers a FAILED link the same way, using the persisted sticker order', async () => {
    const pkg = await createPackageViaHttp(ctx.app, token, 'Pack B');
    const stickerOne = await createStickerViaHttp(ctx.app, token, { packageId: pkg.id, name: 's1' });
    const stickerTwo = await createStickerViaHttp(ctx.app, token, { packageId: pkg.id, name: 's2' });
    const setName = deriveSetName({ packageId: pkg.id, botUsername: BOT_USERNAME });

    const link = new TelegramPackLink({
      id: 'telegram_link_failed_test',
      userId,
      telegramUserId,
      packageId: pkg.id,
      setName,
      status: 'failed',
      stickerIdOrder: [stickerOne.id, stickerTwo.id]
    });
    await ctx.container.repositories.telegramPackLink.save(link);

    queueFetch(getMeResponse(), getSetOkResponse(setName, ['file_a', 'file_b']));

    const res = await exportPackRequest(ctx.app, token, {
      packageId: pkg.id,
      stickerIds: [stickerOne.id, stickerTwo.id],
      telegramUserId
    });

    expect(res.status).toBe(200);
    const persisted = await ctx.container.repositories.telegramPackLink.findByUserIdAndPackageId(userId, pkg.id);
    expect(persisted.status).toBe('active');
    expect(persisted.stickerFileIds).toEqual({ [stickerOne.id]: 'file_a', [stickerTwo.id]: 'file_b' });
  });

  it('never calls createNewStickerSet when the status check times out (ambiguous)', async () => {
    const pkg = await createPackageViaHttp(ctx.app, token, 'Pack C');
    const sticker = await createStickerViaHttp(ctx.app, token, { packageId: pkg.id });
    const setName = deriveSetName({ packageId: pkg.id, botUsername: BOT_USERNAME });

    const link = TelegramPackLink.create({
      userId, telegramUserId, packageId: pkg.id, setName, stickerIdOrder: [sticker.id]
    });
    await ctx.container.repositories.telegramPackLink.save(link);

    const fetchSpy = queueFetch(getMeResponse(), new Error('The operation was aborted'));

    const res = await exportPackRequest(ctx.app, token, { packageId: pkg.id, stickerIds: [sticker.id], telegramUserId });

    expect(res.status).toBeGreaterThanOrEqual(500);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(fetchSpy.mock.calls.some(([url]) => String(url).includes('createNewStickerSet'))).toBe(false);

    const persisted = await ctx.container.repositories.telegramPackLink.findByUserIdAndPackageId(userId, pkg.id);
    // Ambiguous result must never flip the link to ACTIVE or FAILED.
    expect(persisted.status).toBe('pending');
  });

  it('does not treat a 429 or 5xx status check as non-existence either', async () => {
    const pkg = await createPackageViaHttp(ctx.app, token, 'Pack D');
    const sticker = await createStickerViaHttp(ctx.app, token, { packageId: pkg.id });
    const setName = deriveSetName({ packageId: pkg.id, botUsername: BOT_USERNAME });

    const link = TelegramPackLink.create({
      userId, telegramUserId, packageId: pkg.id, setName, stickerIdOrder: [sticker.id]
    });
    await ctx.container.repositories.telegramPackLink.save(link);

    const fetchSpy = queueFetch(getMeResponse(), getSetRateLimitedResponse());

    const res = await exportPackRequest(ctx.app, token, { packageId: pkg.id, stickerIds: [sticker.id], telegramUserId });

    expect(res.status).toBeGreaterThanOrEqual(500);
    expect(fetchSpy.mock.calls.some(([url]) => String(url).includes('createNewStickerSet'))).toBe(false);
    const persisted = await ctx.container.repositories.telegramPackLink.findByUserIdAndPackageId(userId, pkg.id);
    expect(persisted.status).toBe('pending');
  });

  it('creates a new set only after Telegram explicitly confirms the set does not exist', async () => {
    const pkg = await createPackageViaHttp(ctx.app, token, 'Pack E');
    const sticker = await createStickerViaHttp(ctx.app, token, { packageId: pkg.id });
    const setName = deriveSetName({ packageId: pkg.id, botUsername: BOT_USERNAME });

    const link = TelegramPackLink.create({
      userId, telegramUserId, packageId: pkg.id, setName, stickerIdOrder: [sticker.id]
    });
    await ctx.container.repositories.telegramPackLink.save(link);

    queueFetch(getMeResponse(), getSetNotFoundResponse(), createSetOkResponse(), getSetOkResponse(setName, ['file_new']));

    const res = await exportPackRequest(ctx.app, token, { packageId: pkg.id, stickerIds: [sticker.id], telegramUserId });

    expect(res.status).toBe(201);
    const persisted = await ctx.container.repositories.telegramPackLink.findByUserIdAndPackageId(userId, pkg.id);
    expect(persisted.status).toBe('active');
    expect(persisted.stickerFileIds).toEqual({ [sticker.id]: 'file_new' });
  });

  it('recovers via getStickerSet when createNewStickerSet reports the name is already occupied', async () => {
    const pkg = await createPackageViaHttp(ctx.app, token, 'Pack F');
    const sticker = await createStickerViaHttp(ctx.app, token, { packageId: pkg.id });
    const setName = deriveSetName({ packageId: pkg.id, botUsername: BOT_USERNAME });

    queueFetch(
      getMeResponse(),
      createSetNameOccupiedResponse(),
      getSetOkResponse(setName, ['file_recovered'])
    );

    const res = await exportPackRequest(ctx.app, token, { packageId: pkg.id, stickerIds: [sticker.id], telegramUserId });

    expect(res.status).toBe(200);
    const persisted = await ctx.container.repositories.telegramPackLink.findByUserIdAndPackageId(userId, pkg.id);
    expect(persisted.status).toBe('active');
    expect(persisted.stickerFileIds).toEqual({ [sticker.id]: 'file_recovered' });
  });

  it('leaves the link PENDING (not ACTIVE, not FAILED) when create succeeds but confirmation fails, then recovers on retry', async () => {
    const pkg = await createPackageViaHttp(ctx.app, token, 'Pack G');
    const sticker = await createStickerViaHttp(ctx.app, token, { packageId: pkg.id });
    const setName = deriveSetName({ packageId: pkg.id, botUsername: BOT_USERNAME });

    queueFetch(getMeResponse(), createSetOkResponse(), getSetServerErrorResponse());

    const firstAttempt = await exportPackRequest(ctx.app, token, { packageId: pkg.id, stickerIds: [sticker.id], telegramUserId });
    expect(firstAttempt.status).toBeGreaterThanOrEqual(500);

    const afterFirstAttempt = await ctx.container.repositories.telegramPackLink.findByUserIdAndPackageId(userId, pkg.id);
    expect(afterFirstAttempt.status).toBe('pending');
    expect(afterFirstAttempt.stickerFileIds).toEqual({});
    expect(afterFirstAttempt.stickerIdOrder).toEqual([sticker.id]);

    vi.unstubAllGlobals();
    queueFetch(getMeResponse(), getSetOkResponse(setName, ['file_retry']));

    const retry = await exportPackRequest(ctx.app, token, { packageId: pkg.id, stickerIds: [sticker.id], telegramUserId });
    expect(retry.status).toBe(200);

    const afterRetry = await ctx.container.repositories.telegramPackLink.findByUserIdAndPackageId(userId, pkg.id);
    expect(afterRetry.status).toBe('active');
    expect(afterRetry.stickerFileIds).toEqual({ [sticker.id]: 'file_retry' });
  });

  it('rejects a foreign package before any Telegram call', async () => {
    const pkg = await createPackageViaHttp(ctx.app, token, 'Owned by A');
    const sticker = await createStickerViaHttp(ctx.app, token, { packageId: pkg.id });
    const otherToken = makeUserAccessToken('other-user@example.com');

    const fetchSpy = queueFetch(getMeResponse(), createSetOkResponse(), getSetOkResponse('x', []));
    const res = await exportPackRequest(ctx.app, otherToken, {
      packageId: pkg.id,
      stickerIds: [sticker.id],
      telegramUserId
    });

    expect(res.status).toBe(404);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('rejects a foreign telegram_pack_link when reconciling without calling Telegram', async () => {
    const pkg = await createPackageViaHttp(ctx.app, token, 'Owned by A 2');
    await createStickerViaHttp(ctx.app, token, { packageId: pkg.id });
    const setName = deriveSetName({ packageId: pkg.id, botUsername: BOT_USERNAME });
    const link = TelegramPackLink.create({ userId, telegramUserId, packageId: pkg.id, setName });
    link.markActive();
    await ctx.container.repositories.telegramPackLink.save(link);

    const otherToken = makeUserAccessToken('other-user-2@example.com');
    const fetchSpy = queueFetch(getMeResponse());
    const body = { package_id: pkg.id, sticker_ids_to_add: [], sticker_ids_to_remove: [] };
    const headers = signRequest({ method: 'POST', path: '/api/v1/telegram/reconcile-pack', body, clientId: CLIENT_ID, clientSecret: CLIENT_SECRET });
    const res = await request(ctx.app)
      .post('/api/v1/telegram/reconcile-pack')
      .set(headers)
      .set('Authorization', `Bearer ${otherToken}`)
      .send(body);

    expect(res.status).toBe(404);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('rejects a foreign set name on pack-status without calling Telegram', async () => {
    const pkg = await createPackageViaHttp(ctx.app, token, 'Owned by A 3');
    const setName = deriveSetName({ packageId: pkg.id, botUsername: BOT_USERNAME });
    const link = TelegramPackLink.create({ userId, telegramUserId, packageId: pkg.id, setName });
    link.markActive();
    await ctx.container.repositories.telegramPackLink.save(link);

    const otherToken = makeUserAccessToken('other-user-3@example.com');
    const fetchSpy = queueFetch(getMeResponse());
    const headers = signRequest({ method: 'GET', path: `/api/v1/telegram/pack-status/${setName}`, clientId: CLIENT_ID, clientSecret: CLIENT_SECRET });
    const res = await request(ctx.app)
      .get(`/api/v1/telegram/pack-status/${setName}`)
      .set(headers)
      .set('Authorization', `Bearer ${otherToken}`);

    expect(res.status).toBe(404);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('rejects client-supplied file_ids on reconcile-pack without calling Telegram', async () => {
    const pkg = await createPackageViaHttp(ctx.app, token, 'Pack H');
    const setName = deriveSetName({ packageId: pkg.id, botUsername: BOT_USERNAME });
    const link = TelegramPackLink.create({ userId, telegramUserId, packageId: pkg.id, setName });
    link.markActive();
    await ctx.container.repositories.telegramPackLink.save(link);

    const fetchSpy = queueFetch(getMeResponse());
    const body = { package_id: pkg.id, file_ids: ['forged'] };
    const headers = signRequest({ method: 'POST', path: '/api/v1/telegram/reconcile-pack', body, clientId: CLIENT_ID, clientSecret: CLIENT_SECRET });
    const res = await request(ctx.app)
      .post('/api/v1/telegram/reconcile-pack')
      .set(headers)
      .set('Authorization', `Bearer ${token}`)
      .send(body);

    expect(res.status).toBe(400);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

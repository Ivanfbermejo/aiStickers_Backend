import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

process.env.ENABLE_TELEGRAM = 'true';
process.env.TELEGRAM_BOT_TOKEN = 'test-token';

const { exportPack, reconcilePack } = await import('../../src/application/services/telegram.service.js');

describe('Telegram Bot API payload shape', () => {
  let fetchSpy;

  beforeEach(() => {
    fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('createNewStickerSet sends real JSON InputSticker objects', async () => {
    const responses = [
      new Response(
        JSON.stringify({ ok: true, result: { username: 'bot' } }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      ),
      new Response(
        JSON.stringify({ ok: true, result: true }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      ),
      new Response(
        JSON.stringify({ ok: true, result: { name: 'set', stickers: [] } }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      )
    ];
    fetchSpy.mockImplementation(() => Promise.resolve(responses.shift()));

    await exportPack({
      telegramUserId: '12345',
      setName: 'aistickers_pack_by_bot',
      packTitle: 'My pack',
      stickerReferences: ['https://example.com/sticker.png']
    });

    const createCall = fetchSpy.mock.calls.find(([url]) =>
      typeof url === 'string' && url.includes('createNewStickerSet')
    );
    const body = JSON.parse(createCall[1].body);
    expect(body.user_id).toBe(12345);
    expect(body.name).toBe('aistickers_pack_by_bot');
    expect(body.title).toBe('My pack');
    expect(Array.isArray(body.stickers)).toBe(true);
    expect(body.stickers).toHaveLength(1);
    expect(body.stickers[0]).toEqual({
      sticker: 'https://example.com/sticker.png',
      format: 'static',
      emoji_list: ['🙂']
    });
  });

  it('addStickerToSet sends a real JSON InputSticker object', async () => {
    const responses = [
      new Response(
        JSON.stringify({ ok: true, result: { file_id: 'file_abc' } }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      ),
      new Response(
        JSON.stringify({ ok: true, result: true }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      ),
      new Response(
        JSON.stringify({ ok: true, result: { name: 'set', stickers: [] } }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      )
    ];
    fetchSpy.mockImplementation(() => Promise.resolve(responses.shift()));

    await reconcilePack({
      telegramUserId: '12345',
      setName: 'aistickers_pack_by_bot',
      stickerReferencesToAdd: ['https://example.com/new.png'],
      stickerFileIdsToRemove: []
    });

    const calls = fetchSpy.mock.calls.map(([_, opts]) =>
      opts && opts.body ? JSON.parse(opts.body) : null
    );
    const addBody = calls[1];

    expect(addBody.user_id).toBe(12345);
    expect(addBody.name).toBe('aistickers_pack_by_bot');
    expect(addBody.sticker).toEqual({
      sticker: 'file_abc',
      format: 'static',
      emoji_list: ['🙂']
    });
    expect(typeof addBody.sticker).toBe('object');
  });
});

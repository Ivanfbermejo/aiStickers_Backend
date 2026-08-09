import crypto from 'node:crypto';
import { env } from '../../config/env.js';

const DISABLED_MESSAGE = 'Telegram sticker export is temporarily disabled';
const TELEGRAM_API = 'https://api.telegram.org';
const LOGIN_MAX_AGE_SECONDS = 24 * 60 * 60;

function assertEnabled() {
  if (!env.ENABLE_TELEGRAM) {
    throw new Error(DISABLED_MESSAGE);
  }
  if (!env.TELEGRAM_BOT_TOKEN) {
    throw new Error('Telegram bot token is not configured');
  }
}

function safeEqualHex(left, right) {
  if (!/^[a-f0-9]{64}$/i.test(left) || !/^[a-f0-9]{64}$/i.test(right)) return false;
  return crypto.timingSafeEqual(Buffer.from(left, 'hex'), Buffer.from(right, 'hex'));
}

/** Verify Telegram Login Widget data before trusting telegramUserId. */
export function verifyTelegramLogin(payload, nowSeconds = Math.floor(Date.now() / 1000)) {
  assertEnabled();
  if (!payload || typeof payload !== 'object' || !payload.id || !payload.auth_date || !payload.hash) {
    throw new Error('Telegram authorization proof is required');
  }

  const authDate = Number(payload.auth_date);
  if (!Number.isInteger(authDate) || authDate < nowSeconds - LOGIN_MAX_AGE_SECONDS || authDate > nowSeconds + 60) {
    throw new Error('Telegram authorization proof is expired');
  }

  const dataCheckString = Object.entries(payload)
    .filter(([key]) => key !== 'hash' && payload[key] !== undefined && payload[key] !== null)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');
  const secretKey = crypto.createHash('sha256').update(env.TELEGRAM_BOT_TOKEN).digest();
  const expectedHash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');
  if (!safeEqualHex(String(payload.hash), expectedHash)) {
    throw new Error('Invalid Telegram authorization proof');
  }

  return {
    telegramUserId: String(payload.id),
    username: payload.username ? String(payload.username) : undefined
  };
}

function sanitizedPart(value) {
  return String(value).replace(/[^a-zA-Z0-9_]/g, '').slice(0, 28) || 'pack';
}

/** The server derives this identity; clients never provide a set name. */
export function deriveSetName({ packageId, botUsername }) {
  const suffix = sanitizedPart(botUsername).replace(/^@/, '');
  const packagePart = sanitizedPart(packageId);
  return `aistickers_${packagePart}_by_${suffix}`.slice(0, 64);
}

async function callTelegram(method, payload) {
  assertEnabled();
  const response = await fetch(`${TELEGRAM_API}/bot${env.TELEGRAM_BOT_TOKEN}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload)
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || body.ok !== true) {
    throw new Error(body.description || `Telegram ${method} failed`);
  }
  return body.result;
}

export async function getBotUsername() {
  const bot = await callTelegram('getMe', {});
  if (!bot?.username) throw new Error('Telegram bot has no username');
  return bot.username;
}

function inputSticker(reference) {
  return { type: 'static', sticker: reference, emoji: '🙂' };
}

export async function exportPack({ telegramUserId, setName, packTitle, stickerReferences } = {}) {
  assertEnabled();
  if (!telegramUserId || !setName || !packTitle || !Array.isArray(stickerReferences) || stickerReferences.length === 0) {
    throw new Error('Telegram pack export data is incomplete');
  }
  await callTelegram('createNewStickerSet', {
    user_id: Number(telegramUserId),
    name: setName,
    title: packTitle,
    stickers: JSON.stringify(stickerReferences.map(inputSticker))
  });
  const set = await callTelegram('getStickerSet', { name: setName });
  return {
    setName,
    stickerCount: set?.stickers?.length || 0,
    stickers: set?.stickers || [],
    addStickerUrl: `https://t.me/addstickers/${setName}`
  };
}

async function uploadStickerFile({ telegramUserId, reference }) {
  const result = await callTelegram('uploadStickerFile', {
    user_id: Number(telegramUserId),
    sticker: reference,
    sticker_format: 'static'
  });
  if (!result?.file_id) throw new Error('Telegram did not return a sticker file ID');
  return result.file_id;
}

export async function reconcilePack({
  telegramUserId,
  setName,
  stickerReferencesToAdd = [],
  stickerFileIdsToRemove = []
} = {}) {
  assertEnabled();
  let added = 0;
  const addedFileIds = [];
  for (const reference of stickerReferencesToAdd) {
    const fileId = await uploadStickerFile({ telegramUserId, reference });
    await callTelegram('addStickerToSet', {
      user_id: Number(telegramUserId),
      name: setName,
      sticker: JSON.stringify(inputSticker(fileId))
    });
    added += 1;
    addedFileIds.push(fileId);
  }

  let removed = 0;
  for (const fileId of stickerFileIdsToRemove) {
    await callTelegram('deleteStickerFromSet', { name: setName, sticker: fileId });
    removed += 1;
  }

  const set = await callTelegram('getStickerSet', { name: setName });
  return {
    setName,
    added,
    removed,
    addedFileIds,
    stickers: set?.stickers || [],
    addStickerUrl: `https://t.me/addstickers/${setName}`
  };
}

export async function getPackStatus({ setName } = {}) {
  assertEnabled();
  if (!setName) throw new Error('setName is required');
  const set = await callTelegram('getStickerSet', { name: setName });
  return {
    setName,
    title: set?.title,
    stickerCount: set?.stickers?.length || 0,
    stickerIds: (set?.stickers || []).map(sticker => sticker.file_id),
    addStickerUrl: `https://t.me/addstickers/${setName}`
  };
}

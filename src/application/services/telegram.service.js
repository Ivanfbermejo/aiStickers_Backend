import crypto from 'node:crypto';
import { env } from '../../config/env.js';

const DISABLED_MESSAGE = 'Telegram sticker export is temporarily disabled';
const TELEGRAM_API = 'https://api.telegram.org';
const LOGIN_MAX_AGE_SECONDS = 24 * 60 * 60;
const REQUEST_TIMEOUT_MS = 15000;

function assertEnabled() {
  if (!env.ENABLE_TELEGRAM) {
    throw new Error(DISABLED_MESSAGE);
  }
  if (!env.TELEGRAM_BOT_TOKEN) {
    throw new Error('Telegram bot token is not configured');
  }
}

/**
 * Raised for any non-2xx/non-ok response from the Telegram Bot API, and for
 * transport-level failures (network errors, timeouts). `httpStatus` is only
 * set when we actually got an HTTP response back from Telegram; its absence
 * signals a transport failure, which must always be treated as ambiguous.
 */
export class TelegramApiError extends Error {
  constructor(message, { httpStatus, errorCode, cause } = {}) {
    super(message);
    this.name = 'TelegramApiError';
    this.httpStatus = httpStatus;
    this.errorCode = errorCode;
    if (cause) this.cause = cause;
  }
}

const NOT_FOUND_PATTERNS = [/stickerset_invalid/i, /sticker set (is )?not found/i];
const NAME_OCCUPIED_PATTERNS = [/already occupied/i, /name is occupied/i];

/**
 * Classify a TelegramApiError so callers can decide whether it is safe to
 * treat the remote sticker set as definitively absent. Anything that is not
 * an explicit, well-known "does not exist" response — including timeouts,
 * 429s, 5xxs, and unrecognized 4xx bodies — is 'ambiguous' and must never be
 * interpreted as non-existence.
 */
export function classifyTelegramError(error) {
  if (!(error instanceof TelegramApiError) || error.httpStatus !== 400) {
    return 'ambiguous';
  }
  if (NOT_FOUND_PATTERNS.some(pattern => pattern.test(error.message))) return 'not_found';
  if (NAME_OCCUPIED_PATTERNS.some(pattern => pattern.test(error.message))) return 'name_occupied';
  return 'ambiguous';
}

/**
 * Classify a failure from `createRemoteSet` (createNewStickerSet) so callers
 * know whether it is safe to mark the local link FAILED.
 *
 * - 'ambiguous': transport failure/timeout (no httpStatus), HTTP 429, or any
 *   HTTP >=500. We never learned whether Telegram actually created the set,
 *   so the link must stay PENDING and be re-checked via getRemoteSet before
 *   any retry attempts to create it again.
 * - 'name_occupied': Telegram confirmed the set name is already taken.
 * - 'definitive_failure': Telegram returned an explicit request error (any
 *   other HTTP response) that guarantees no set was created.
 */
export function classifyCreateSetError(error) {
  if (!(error instanceof TelegramApiError) || error.httpStatus === undefined) {
    return 'ambiguous';
  }
  if (error.httpStatus === 429 || error.httpStatus >= 500) {
    return 'ambiguous';
  }
  if (NAME_OCCUPIED_PATTERNS.some(pattern => pattern.test(error.message))) return 'name_occupied';
  return 'definitive_failure';
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
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let response;
  try {
    response = await fetch(`${TELEGRAM_API}/bot${env.TELEGRAM_BOT_TOKEN}/${method}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal
    });
  } catch (error) {
    // Network failure or timeout: we never learned Telegram's answer, so this
    // must be treated as ambiguous by classifyTelegramError (no httpStatus).
    throw new TelegramApiError(`Telegram ${method} request failed: ${error.message}`, { cause: error });
  } finally {
    clearTimeout(timeout);
  }
  const body = await response.json().catch(() => ({}));
  if (!response.ok || body.ok !== true) {
    throw new TelegramApiError(body.description || `Telegram ${method} failed`, {
      httpStatus: response.status,
      errorCode: body.error_code
    });
  }
  return body.result;
}

export async function getBotUsername() {
  const bot = await callTelegram('getMe', {});
  if (!bot?.username) throw new Error('Telegram bot has no username');
  return bot.username;
}

function inputSticker(reference) {
  return { sticker: reference, format: 'static', emoji_list: ['🙂'] };
}

/**
 * Ask Telegram to create the sticker set. Callers must inspect
 * `classifyTelegramError` on failure — in particular a 'name_occupied'
 * classification means the set may already exist remotely (e.g. from a
 * previous attempt that failed only while confirming the result) and should
 * be recovered via `getRemoteSet` rather than treated as a hard failure.
 */
export async function createRemoteSet({ telegramUserId, setName, packTitle, stickerReferences } = {}) {
  assertEnabled();
  if (!telegramUserId || !setName || !packTitle || !Array.isArray(stickerReferences) || stickerReferences.length === 0) {
    throw new Error('Telegram pack export data is incomplete');
  }
  await callTelegram('createNewStickerSet', {
    user_id: Number(telegramUserId),
    name: setName,
    title: packTitle,
    stickers: stickerReferences.map(inputSticker)
  });
}

/**
 * Look up a remote sticker set. Resolves `{ exists: false }` only when
 * Telegram explicitly confirms the set does not exist. Any ambiguous result
 * (timeout, 429, 5xx, unrecognized error) is re-thrown so the caller never
 * mistakes "we don't know" for "it doesn't exist".
 */
export async function getRemoteSet({ setName } = {}) {
  assertEnabled();
  if (!setName) throw new Error('setName is required');
  try {
    const set = await callTelegram('getStickerSet', { name: setName });
    return { exists: true, set };
  } catch (error) {
    if (classifyTelegramError(error) === 'not_found') {
      return { exists: false };
    }
    throw error;
  }
}

/**
 * Rebuild the localId -> Telegram file_id map from the local sticker order
 * persisted before the remote call and the sticker list Telegram returns.
 * Telegram preserves upload order, so the Nth remote sticker corresponds to
 * the Nth locally-ordered sticker ID.
 */
export function buildStickerFileIdsFromOrder(stickerIdOrder = [], remoteStickers = []) {
  const stickerFileIds = {};
  stickerIdOrder.forEach((localId, index) => {
    const fileId = remoteStickers[index]?.file_id;
    if (fileId) stickerFileIds[localId] = fileId;
  });
  return stickerFileIds;
}

export async function exportPack({ telegramUserId, setName, packTitle, stickerReferences } = {}) {
  await createRemoteSet({ telegramUserId, setName, packTitle, stickerReferences });
  const { set } = await getRemoteSet({ setName });
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
      sticker: inputSticker(fileId)
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

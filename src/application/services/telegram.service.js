/**
 * TelegramService (stub)
 *
 * Telegram integration is temporarily disabled while it is being secured.
 * The node-telegram-bot-api dependency has been removed; this module will be
 * reintroduced behind a feature flag in T10 if required.
 */

const DISABLED_MESSAGE = 'Telegram sticker export is temporarily disabled';

export async function exportPack() {
  throw new Error(DISABLED_MESSAGE);
}

export async function getPackStatus() {
  throw new Error(DISABLED_MESSAGE);
}

export async function reconcilePack() {
  throw new Error(DISABLED_MESSAGE);
}

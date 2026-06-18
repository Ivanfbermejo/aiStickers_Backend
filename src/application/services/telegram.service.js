/**
 * TelegramService
 *
 * Manages Telegram sticker set creation and reconciliation via node-telegram-bot-api.
 * The bot token is read from environment variables — NEVER hardcoded.
 *
 * Sticker set ownership model:
 *   - The bot CREATES the set (owner = bot).
 *   - Users add the set to their account by opening the addStickerUrl.
 *   - Sets cannot be deleted via the Telegram Bot API; deletePack is a no-op.
 *
 * Telegram constraints:
 *   - Sticker images must be PNG or WebP, exactly 512x512 px.
 *   - A sticker set can have at most 120 stickers.
 *   - Set names: [a-z0-9_] only, max 64 chars, must end with _by_<bot_username>.
 *   - createNewStickerSet: max ~1 call / 5 s per bot (handled by callers via queuing).
 */

import TelegramBot from 'node-telegram-bot-api';
import { env } from '../../config/env.js';
import fetch from 'node-fetch';
import sharp from 'sharp';

let _bot = null;

function getBot() {
    if (!_bot) {
        if (!env.TELEGRAM_BOT_TOKEN) {
            throw new Error('TELEGRAM_BOT_TOKEN is not set in environment variables');
        }
        _bot = new TelegramBot(env.TELEGRAM_BOT_TOKEN);
    }
    return _bot;
}

/**
 * Returns the bot username (e.g. "mybot" from "@mybot").
 * Cached after first call.
 */
let _botUsername = null;
async function getBotUsername() {
    if (!_botUsername) {
        const me = await getBot().getMe();
        _botUsername = me.username;
    }
    return _botUsername;
}

/**
 * Derives a stable Telegram sticker set name from a packageId.
 * Format: <safe_id>_by_<botUsername>  (max 64 chars total)
 */
async function deriveSetName(packageId) {
    const botUsername = await getBotUsername();
    const suffix = `_by_${botUsername}`;
    const maxPrefixLen = 64 - suffix.length;
    const safe = packageId
        .toLowerCase()
        .replace(/[^a-z0-9_]/g, '_')
        .slice(0, maxPrefixLen);
    return `${safe}${suffix}`;
}

/**
 * Downloads an image URL and converts it to a 512x512 PNG buffer.
 * Required by Telegram sticker constraints.
 */
async function toStickerBuffer(imageUrl) {
    const res = await fetch(imageUrl);
    if (!res.ok) throw new Error(`Failed to download sticker image: ${imageUrl} (${res.status})`);
    const arrayBuffer = await res.arrayBuffer();
    const inputBuffer = Buffer.from(arrayBuffer);
    return sharp(inputBuffer)
        .resize(512, 512, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
        .png()
        .toBuffer();
}

/**
 * Creates a new Telegram sticker set.
 * @param {number} userId - Telegram user ID (required by Bot API; use a sentinel if unknown)
 * @param {string} packageId - Local package ID
 * @param {string} packTitle - Human-readable title
 * @param {string[]} stickerUrls - Array of image URLs (max 120)
 * @returns {{ setName, addStickerUrl, stickerCount }}
 */
export async function exportPack({ userId, packageId, packTitle, stickerUrls }) {
    const bot = getBot();
    const setName = await deriveSetName(packageId);
    const MAX = 120;
    const urls = stickerUrls.slice(0, MAX);

    console.log(`[TelegramService] Creating sticker set: ${setName} title="${packTitle}" stickers=${urls.length}`);

    const firstBuffer = await toStickerBuffer(urls[0]);

    await bot.createNewStickerSet(userId, setName, packTitle, firstBuffer, '🎉', {
        png_sticker: firstBuffer,
        emojis: '🎉'
    });

    for (let i = 1; i < urls.length; i++) {
        const buffer = await toStickerBuffer(urls[i]);
        await bot.addStickerToSet(userId, setName, { png_sticker: buffer, emojis: '🎉' });
    }

    const addStickerUrl = `https://t.me/addstickers/${setName}`;
    console.log(`[TelegramService] ✅ Pack created: ${addStickerUrl}`);

    return { setName, addStickerUrl, stickerCount: urls.length };
}

/**
 * Returns the current state of a Telegram sticker set.
 * @returns {{ setName, title, stickerCount, stickerIds, addStickerUrl }}
 */
export async function getPackStatus({ setName }) {
    const bot = getBot();
    const stickerSet = await bot.getStickerSet(setName);
    return {
        setName: stickerSet.name,
        title: stickerSet.title,
        stickerCount: stickerSet.stickers.length,
        stickerIds: stickerSet.stickers.map(s => s.file_id),
        addStickerUrl: `https://t.me/addstickers/${setName}`
    };
}

/**
 * Reconciles a Telegram sticker set: adds missing stickers, removes deleted ones.
 * @param {number} userId
 * @param {string} packageId
 * @param {string} setName
 * @param {string[]} stickerUrlsToAdd
 * @param {string[]} stickerIdsToRemove - Telegram file_ids to delete
 * @returns {{ setName, added, removed, addStickerUrl }}
 */
export async function reconcilePack({ userId, packageId, setName, stickerUrlsToAdd, stickerIdsToRemove }) {
    const bot = getBot();
    let added = 0;
    let removed = 0;

    console.log(`[TelegramService] Reconcile ${setName}: +${stickerUrlsToAdd.length} -${stickerIdsToRemove.length}`);

    for (const fileId of stickerIdsToRemove) {
        try {
            await bot.deleteStickerFromSet(fileId);
            removed++;
        } catch (err) {
            console.warn(`[TelegramService] Could not remove sticker ${fileId}: ${err.message}`);
        }
    }

    for (const url of stickerUrlsToAdd) {
        try {
            const buffer = await toStickerBuffer(url);
            await bot.addStickerToSet(userId, setName, { png_sticker: buffer, emojis: '🎉' });
            added++;
        } catch (err) {
            console.warn(`[TelegramService] Could not add sticker from ${url}: ${err.message}`);
        }
    }

    return {
        setName,
        added,
        removed,
        addStickerUrl: `https://t.me/addstickers/${setName}`
    };
}

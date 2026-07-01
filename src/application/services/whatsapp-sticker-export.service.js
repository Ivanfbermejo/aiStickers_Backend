/**
 * WhatsApp Sticker Export Service
 *
 * Converts generated AI assets into WhatsApp-compatible sticker packs.
 * Responsibilities:
 *   - Download source image/video.
 *   - Resize sticker to 512x512 WebP.
 *   - Compress under WhatsApp limits (animated: 500KB, tray: 50KB).
 *   - Generate 96x96 tray icon.
 *   - Validate final assets against WhatsApp constraints.
 *   - Persist final assets in the uploads directory and return public URLs.
 *
 * WhatsApp constraints:
 *   - Sticker format: WebP (animated or static).
 *   - Sticker resolution: exactly 512x512.
 *   - Animated sticker size: recommended max 500KB.
 *   - Sticker duration: max 10s.
 *   - Tray icon: 96x96, max 50KB.
 *   - Packs must be static OR animated, never mixed.
 *   - Pack must contain between 3 and 30 stickers.
 */

import fs from 'fs';
import path from 'path';
import { nanoid } from 'nanoid';
import fetch from 'node-fetch';
import sharp from 'sharp';
import { env } from '../../config/env.js';

const STICKER_SIZE = 512;
const TRAY_ICON_SIZE = 96;
const MAX_STICKER_SIZE_BYTES = 500 * 1024;
const MAX_TRAY_ICON_SIZE_BYTES = 50 * 1024;
const MAX_DURATION_MS = 10 * 1000;
const MIN_PACK_STICKERS = 3;
const MAX_PACK_STICKERS = 30;

const UPLOADS_DIR = path.join(env.DATA_DIR, 'uploads');

function ensureUploadsDir() {
  if (!fs.existsSync(UPLOADS_DIR)) {
    fs.mkdirSync(UPLOADS_DIR, { recursive: true });
  }
}

function publicUrlFor(relativePath) {
  return `/uploads/${relativePath}`;
}

async function downloadBuffer(url) {
  if (url.startsWith('data:')) {
    const base64 = url.split(',')[1];
    return Buffer.from(base64, 'base64');
  }

  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to download asset: ${url} (${res.status})`);
  }
  const arrayBuffer = await res.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

async function detectSourceType(buffer) {
  try {
    const metadata = await sharp(buffer).metadata();
    return {
      mimeType: `image/${metadata.format}`,
      width: metadata.width,
      height: metadata.height,
      isAnimated: false
    };
  } catch (err) {
    // If sharp cannot parse it, assume video.
    return { mimeType: 'video/*', width: 0, height: 0, isAnimated: true };
  }
}

/**
 * Build a single-frame WebP sticker from an image buffer.
 * Used for static image inputs or when a video converter is unavailable.
 */
async function buildStaticWebpSticker(buffer, quality = 80) {
  const resized = await sharp(buffer)
    .resize(STICKER_SIZE, STICKER_SIZE, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .webp({ quality, lossless: false, effort: 6 })
    .toBuffer();

  const metadata = await sharp(resized).metadata();
  return {
    buffer: resized,
    width: metadata.width,
    height: metadata.height,
    sizeBytes: resized.length,
    mimeType: 'image/webp',
    durationMs: 0
  };
}

async function compressSticker(buffer, quality) {
  return sharp(buffer)
    .resize(STICKER_SIZE, STICKER_SIZE, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .webp({ quality, lossless: false, effort: 6 })
    .toBuffer();
}

async function compressTrayIcon(buffer, quality) {
  return sharp(buffer)
    .resize(TRAY_ICON_SIZE, TRAY_ICON_SIZE, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .webp({ quality, lossless: false, effort: 6 })
    .toBuffer();
}

/**
 * Convert a source image buffer into a WhatsApp-compatible sticker WebP.
 * Returns the final buffer plus metadata.
 */
async function convertSticker(buffer, sourceType) {
  if (sourceType.mimeType.startsWith('video/')) {
    throw new Error(
      'Animated video conversion requires FFmpeg. Please install FFmpeg and wire fluent-ffmpeg to enable full animated WebP generation.'
    );
  }

  let quality = 85;
  let result = await buildStaticWebpSticker(buffer, quality);

  // Compress until under the WhatsApp limit.
  while (result.sizeBytes > MAX_STICKER_SIZE_BYTES && quality > 30) {
    quality -= 10;
    const compressed = await compressSticker(buffer, quality);
    const metadata = await sharp(compressed).metadata();
    result = {
      buffer: compressed,
      width: metadata.width,
      height: metadata.height,
      sizeBytes: compressed.length,
      mimeType: 'image/webp',
      durationMs: 0
    };
  }

  if (result.sizeBytes > MAX_STICKER_SIZE_BYTES) {
    throw new Error(
      `Sticker cannot be compressed under ${MAX_STICKER_SIZE_BYTES / 1024}KB. Current size: ${Math.round(result.sizeBytes / 1024)}KB`
    );
  }

  return result;
}

/**
 * Generate a 96x96 tray icon from a source image buffer.
 */
async function convertTrayIcon(buffer) {
  let quality = 85;
  let compressed = await compressTrayIcon(buffer, quality);

  while (compressed.length > MAX_TRAY_ICON_SIZE_BYTES && quality > 30) {
    quality -= 10;
    compressed = await compressTrayIcon(buffer, quality);
  }

  if (compressed.length > MAX_TRAY_ICON_SIZE_BYTES) {
    throw new Error(
      `Tray icon cannot be compressed under ${MAX_TRAY_ICON_SIZE_BYTES / 1024}KB. Current size: ${Math.round(compressed.length / 1024)}KB`
    );
  }

  const metadata = await sharp(compressed).metadata();
  return {
    buffer: compressed,
    width: metadata.width,
    height: metadata.height,
    sizeBytes: compressed.length,
    mimeType: 'image/webp'
  };
}

async function saveBuffer(buffer, fileName) {
  ensureUploadsDir();
  const filePath = path.join(UPLOADS_DIR, fileName);
  await fs.promises.writeFile(filePath, buffer);
  return filePath;
}

/**
 * Export a single sticker for WhatsApp.
 * @param {string} sourceUrl - URL of the generated image/video.
 * @returns {Promise<{whatsappWebpUrl, width, height, durationMs, sizeBytes, mimeType}>}
 */
export async function exportSticker(sourceUrl) {
  if (!sourceUrl) {
    throw new Error('sourceUrl is required');
  }

  const sourceBuffer = await downloadBuffer(sourceUrl);
  const sourceType = await detectSourceType(sourceBuffer);
  const sticker = await convertSticker(sourceBuffer, sourceType);

  const fileName = `whatsapp_sticker_${nanoid(12)}.webp`;
  await saveBuffer(sticker.buffer, fileName);

  return {
    whatsappWebpUrl: publicUrlFor(fileName),
    width: sticker.width,
    height: sticker.height,
    durationMs: sticker.durationMs,
    sizeBytes: sticker.sizeBytes,
    mimeType: sticker.mimeType
  };
}

/**
 * Export a sticker pack for WhatsApp.
 * @param {Object} params
 * @param {Array<{id, imageUrl, animatedWebpUrl}>} params.stickers - Stickers to include.
 * @param {string} params.sourceUrl - Optional source image for the tray icon.
 * @returns {Promise<{trayIconUrl, whatsappReady, exportStatus, exportError, stickerResults: Array}>}
 */
export async function exportPack({ stickers, sourceUrl }) {
  if (!Array.isArray(stickers) || stickers.length < MIN_PACK_STICKERS || stickers.length > MAX_PACK_STICKERS) {
    throw new Error(`WhatsApp packs need between ${MIN_PACK_STICKERS} and ${MAX_PACK_STICKERS} stickers`);
  }

  const stickerResults = [];
  let hasAnimated = false;
  let hasStatic = false;
  let hasFailure = false;

  for (const sticker of stickers) {
    const inputUrl = sticker.animatedWebpUrl || sticker.imageUrl;
    try {
      const result = await exportSticker(inputUrl);
      stickerResults.push({ id: sticker.id, ...result });
      if (result.durationMs > 0) {
        hasAnimated = true;
      } else {
        hasStatic = true;
      }
    } catch (err) {
      hasFailure = true;
      stickerResults.push({ id: sticker.id, error: err.message });
    }
  }

  // WhatsApp packs cannot be mixed.
  if (hasAnimated && hasStatic) {
    throw new Error('WhatsApp packs cannot mix static and animated stickers');
  }

  // Tray icon from the first sticker or an optional source URL.
  const traySourceUrl = sourceUrl || stickers[0]?.imageUrl;
  if (!traySourceUrl) {
    throw new Error('Cannot generate tray icon: no source image available');
  }

  const traySourceBuffer = await downloadBuffer(traySourceUrl);
  const trayIcon = await convertTrayIcon(traySourceBuffer);
  const trayFileName = `whatsapp_tray_${nanoid(12)}.webp`;
  await saveBuffer(trayIcon.buffer, trayFileName);

  const whatsappReady = !hasFailure && stickerResults.length >= MIN_PACK_STICKERS;

  return {
    trayIconUrl: publicUrlFor(trayFileName),
    whatsappReady,
    exportStatus: whatsappReady ? 'ready' : 'failed',
    exportError: whatsappReady ? null : 'One or more stickers failed to export',
    stickerResults,
    packType: hasAnimated ? 'animated' : 'static'
  };
}

/**
 * Validate a sticker buffer against WhatsApp constraints.
 */
export async function validateSticker(whatsappWebpUrl) {
  const buffer = await downloadBuffer(whatsappWebpUrl);
  const metadata = await sharp(buffer).metadata();

  const errors = [];
  if (metadata.width !== STICKER_SIZE || metadata.height !== STICKER_SIZE) {
    errors.push(`Invalid resolution: ${metadata.width}x${metadata.height}, expected ${STICKER_SIZE}x${STICKER_SIZE}`);
  }
  if (buffer.length > MAX_STICKER_SIZE_BYTES) {
    errors.push(`Sticker too large: ${Math.round(buffer.length / 1024)}KB, max ${MAX_STICKER_SIZE_BYTES / 1024}KB`);
  }

  return {
    valid: errors.length === 0,
    width: metadata.width,
    height: metadata.height,
    sizeBytes: buffer.length,
    mimeType: 'image/webp',
    errors
  };
}

/**
 * Validate a tray icon buffer against WhatsApp constraints.
 */
export async function validateTrayIcon(trayIconUrl) {
  const buffer = await downloadBuffer(trayIconUrl);
  const metadata = await sharp(buffer).metadata();

  const errors = [];
  if (metadata.width !== TRAY_ICON_SIZE || metadata.height !== TRAY_ICON_SIZE) {
    errors.push(`Invalid tray icon resolution: ${metadata.width}x${metadata.height}, expected ${TRAY_ICON_SIZE}x${TRAY_ICON_SIZE}`);
  }
  if (buffer.length > MAX_TRAY_ICON_SIZE_BYTES) {
    errors.push(`Tray icon too large: ${Math.round(buffer.length / 1024)}KB, max ${MAX_TRAY_ICON_SIZE_BYTES / 1024}KB`);
  }

  return {
    valid: errors.length === 0,
    width: metadata.width,
    height: metadata.height,
    sizeBytes: buffer.length,
    mimeType: 'image/webp',
    errors
  };
}

export const WHATSAPP_CONSTRAINTS = {
  STICKER_SIZE,
  TRAY_ICON_SIZE,
  MAX_STICKER_SIZE_BYTES,
  MAX_TRAY_ICON_SIZE_BYTES,
  MAX_DURATION_MS,
  MIN_PACK_STICKERS,
  MAX_PACK_STICKERS
};

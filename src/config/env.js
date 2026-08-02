import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load .env file
dotenv.config({ path: path.join(__dirname, '../../.env') });

/**
 * Parse TEST_JWTS environment variable into an array of test JWT strings.
 * Accepts a JSON array string. Returns an empty array if the variable is
 * unset, empty, invalid JSON, or not an array of strings.
 */
export function parseTestJwts(value) {
  if (!value || value.trim() === '') {
    return [];
  }
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.filter(item => typeof item === 'string' && item.trim() !== '');
  } catch {
    return [];
  }
}

function parseBooleanFlag(value, defaultValue = false) {
  if (value === undefined || value === null || value.trim() === '') {
    return defaultValue;
  }
  const normalized = value.trim().toLowerCase();
  if (['true', '1', 'yes', 'on'].includes(normalized)) {
    return true;
  }
  if (['false', '0', 'no', 'off'].includes(normalized)) {
    return false;
  }
  throw new Error(`Invalid boolean flag: ${value}`);
}

function parsePort(value, defaultValue) {
  if (!value || value.trim() === '') {
    return defaultValue;
  }
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('PORT must be an integer between 1 and 65535');
  }
  return port;
}

function parseSigWindow(value, defaultValue) {
  if (!value || value.trim() === '') {
    return defaultValue;
  }
  const seconds = Number(value);
  if (!Number.isInteger(seconds) || seconds < 1) {
    throw new Error('SIG_WINDOW_SEC must be a positive integer');
  }
  return seconds;
}

function parseCorsOrigins(value, isProduction) {
  if (!isProduction) {
    return '*';
  }
  if (!value || value.trim() === '') {
    throw new Error('CORS_ORIGINS is required in production');
  }
  const origins = value.split(',').map(o => o.trim()).filter(Boolean);
  if (origins.length === 0) {
    throw new Error('CORS_ORIGINS must contain at least one origin in production');
  }
  return origins;
}

function parseJson(value, name) {
  if (!value || value.trim() === '') {
    return undefined;
  }
  try {
    return JSON.parse(value);
  } catch {
    throw new Error(`${name} must be valid JSON`);
  }
}

/**
 * Build a typed configuration object from process.env.
 * Throws on invalid values so the process fails fast.
 */
export function loadConfig(rawEnv = process.env) {
  const nodeEnv = rawEnv.NODE_ENV || 'development';
  const isProduction = nodeEnv === 'production';

  const config = {
    NODE_ENV: nodeEnv,
    PORT: parsePort(rawEnv.PORT, 22024),
    DATA_DIR: rawEnv.DATA_DIR || '/var/www/aiStickers_Backend/data',

    JWT_SECRET: rawEnv.JWT_SECRET,
    JWT_EXPIRES_IN: rawEnv.JWT_EXPIRES_IN || '24h',

    // In production explicit values are required; defaults are development-only.
    CLIENT_ID: isProduction ? rawEnv.CLIENT_ID : (rawEnv.CLIENT_ID || 'ai-stickers'),
    CLIENT_SECRET: rawEnv.CLIENT_SECRET,

    GOOGLE_CLIENT_ID: rawEnv.GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET: rawEnv.GOOGLE_CLIENT_SECRET,
    GOOGLE_PACKAGE_NAME: isProduction ? rawEnv.GOOGLE_PACKAGE_NAME : (rawEnv.GOOGLE_PACKAGE_NAME || 'com.animatedsticker.aistickers'),

    APPLE_CLIENT_ID: rawEnv.APPLE_CLIENT_ID,

    GOOGLE_PLAY_SERVICE_ACCOUNT: rawEnv.GOOGLE_PLAY_SERVICE_ACCOUNT,

    POEDITOR_API_TOKEN: rawEnv.POEDITOR_API_TOKEN,
    POEDITOR_PROJECT_ID: rawEnv.POEDITOR_PROJECT_ID,

    REPLICATE_API_TOKEN: rawEnv.REPLICATE_API_TOKEN,
    REPLICATE_MODEL: isProduction ? rawEnv.REPLICATE_MODEL : (rawEnv.REPLICATE_MODEL || 'google/nano-banana'),
    REPLICATE_IMG2VID_MODEL: isProduction ? rawEnv.REPLICATE_IMG2VID_MODEL : (rawEnv.REPLICATE_IMG2VID_MODEL || 'bytedance/seedance-1-pro'),

    SIG_WINDOW_SEC: parseSigWindow(rawEnv.SIG_WINDOW_SEC, 300),

    TELEGRAM_BOT_TOKEN: rawEnv.TELEGRAM_BOT_TOKEN,

    ENABLE_APPLE_PAYMENTS: parseBooleanFlag(rawEnv.ENABLE_APPLE_PAYMENTS, false),
    ENABLE_TELEGRAM: parseBooleanFlag(rawEnv.ENABLE_TELEGRAM, false),
    ENABLE_WHATSAPP_EXPORT: parseBooleanFlag(rawEnv.ENABLE_WHATSAPP_EXPORT, false),
    ENABLE_EXTERNAL_IMAGE_URLS: parseBooleanFlag(rawEnv.ENABLE_EXTERNAL_IMAGE_URLS, false),
    ENABLE_TEST_JWTS: parseBooleanFlag(rawEnv.ENABLE_TEST_JWTS, false),

    CORS_ORIGINS: null,
    TEST_JWTS: []
  };

  config.CORS_ORIGINS = parseCorsOrigins(rawEnv.CORS_ORIGINS, isProduction);

  const rawTestJwts = rawEnv.TEST_JWTS;
  if (isProduction && rawTestJwts && rawTestJwts.trim() !== '') {
    throw new Error('TEST_JWTS cannot be configured in production');
  }
  if (config.ENABLE_TEST_JWTS) {
    config.TEST_JWTS = parseTestJwts(rawTestJwts);
  }

  return config;
}

// Backwards-compatible alias.
export const buildConfig = loadConfig;

/**
 * Validate required secrets and settings.
 * In production every critical secret must be explicit and meet length/format rules.
 * In development missing values are allowed for convenience.
 */
export function validateEnv(config) {
  if (config.NODE_ENV !== 'production') {
    return;
  }

  function requireString(name, minLength = 1) {
    const value = config[name];
    if (!value || value.trim() === '') {
      throw new Error(`Missing required environment variable in production: ${name}`);
    }
    if (value.length < minLength) {
      throw new Error(`${name} must be at least ${minLength} characters in production`);
    }
  }

  requireString('JWT_SECRET', 32);
  requireString('CLIENT_SECRET', 32);
  requireString('CLIENT_ID', 1);
  requireString('GOOGLE_PACKAGE_NAME', 1);
  requireString('GOOGLE_CLIENT_ID', 1);
  requireString('GOOGLE_CLIENT_SECRET', 16);
  requireString('REPLICATE_API_TOKEN', 1);
  requireString('REPLICATE_MODEL', 1);
  requireString('REPLICATE_IMG2VID_MODEL', 1);
  requireString('GOOGLE_PLAY_SERVICE_ACCOUNT', 1);

  try {
    JSON.parse(config.GOOGLE_PLAY_SERVICE_ACCOUNT);
  } catch {
    throw new Error('GOOGLE_PLAY_SERVICE_ACCOUNT must be valid JSON in production');
  }

  if (config.ENABLE_APPLE_PAYMENTS) {
    requireString('APPLE_CLIENT_ID', 1);
  }

  if (config.ENABLE_TELEGRAM) {
    requireString('TELEGRAM_BOT_TOKEN', 1);
  }
}

export const env = loadConfig();

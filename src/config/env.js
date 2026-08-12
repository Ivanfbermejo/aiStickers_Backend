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

export function isValidGooglePlayServiceAccount(value) {
  if (typeof value !== 'string' || value.trim() === '') return false;

  let serviceAccount;
  try {
    serviceAccount = JSON.parse(value);
  } catch {
    return false;
  }

  if (!serviceAccount || typeof serviceAccount !== 'object' || Array.isArray(serviceAccount)) {
    return false;
  }

  return serviceAccount.type === 'service_account'
    && typeof serviceAccount.project_id === 'string'
    && serviceAccount.project_id.trim() !== ''
    && typeof serviceAccount.client_email === 'string'
    && serviceAccount.client_email.trim() !== ''
    && typeof serviceAccount.private_key === 'string'
    && serviceAccount.private_key.trim() !== '';
}

function parseHostAllowlist(value) {
  if (!value || value.trim() === '') {
    return [];
  }
  const parsed = parseJson(value, 'EXTERNAL_IMAGE_URL_ALLOWLIST');
  if (!Array.isArray(parsed)) {
    throw new Error('EXTERNAL_IMAGE_URL_ALLOWLIST must be a JSON array');
  }
  return parsed.filter(item => typeof item === 'string' && item.trim() !== '');
}

const PERSISTENCE_DRIVERS = ['json', 'postgres'];
const ASSET_STORAGE_DRIVERS = ['local', 's3'];

/**
 * PERSISTENCE_DRIVER selects the repository backend. JSON files remain the
 * default everywhere until T05B implements the Postgres repositories.
 * Production must opt into 'postgres' explicitly (see validateEnv).
 */
function parsePersistenceDriver(value) {
  if (!value || value.trim() === '') {
    return 'json';
  }
  const driver = value.trim().toLowerCase();
  if (!PERSISTENCE_DRIVERS.includes(driver)) {
    throw new Error(`PERSISTENCE_DRIVER must be one of: ${PERSISTENCE_DRIVERS.join(', ')}`);
  }
  return driver;
}

function parseAssetStorageDriver(value, isProduction) {
  if (!value || value.trim() === '') {
    return isProduction ? undefined : 'local';
  }
  const driver = value.trim().toLowerCase();
  if (!ASSET_STORAGE_DRIVERS.includes(driver)) {
    throw new Error(`ASSET_STORAGE_DRIVER must be one of: ${ASSET_STORAGE_DRIVERS.join(', ')}`);
  }
  return driver;
}

function parsePositiveInt(value, defaultValue, name, maxValue = Number.MAX_SAFE_INTEGER) {
  if (!value || value.trim() === '') {
    return defaultValue;
  }
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1 || n > maxValue) {
    throw new Error(`${name} must be an integer between 1 and ${maxValue}`);
  }
  return n;
}

function parseTrustProxy(value) {
  if (!value || value.trim() === '') {
    return 0;
  }

  const normalized = value.trim();
  if (/^\d+$/.test(normalized)) {
    return Number(normalized);
  }

  const networks = normalized.split(',').map(item => item.trim()).filter(Boolean);
  if (networks.length === 0 || networks.some(item => /^(true|false)$/i.test(item))) {
    throw new Error('TRUST_PROXY must be an explicit hop count or comma-separated network list');
  }
  return networks;
}

function parseRedisUrl(value) {
  const redisUrl = value || 'redis://127.0.0.1:6379';
  let parsed;
  try {
    parsed = new URL(redisUrl);
  } catch {
    throw new Error('REDIS_URL must be a valid redis:// or rediss:// URL');
  }
  if (!['redis:', 'rediss:'].includes(parsed.protocol)) {
    throw new Error('REDIS_URL must use redis:// or rediss://');
  }
  return redisUrl;
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
    PORT: parsePort(rawEnv.PORT, 2002),
    DATA_DIR: rawEnv.DATA_DIR || '/var/www/aiStickers_Backend/data',
    TRUST_PROXY: parseTrustProxy(rawEnv.TRUST_PROXY),

    LOG_LEVEL: rawEnv.LOG_LEVEL || '',
    SHUTDOWN_TIMEOUT_MS: parsePositiveInt(rawEnv.SHUTDOWN_TIMEOUT_MS, 30000, 'SHUTDOWN_TIMEOUT_MS', 300000),

    METRICS_ENABLED: parseBooleanFlag(rawEnv.METRICS_ENABLED, false),
    METRICS_BEARER_TOKEN: rawEnv.METRICS_BEARER_TOKEN || '',

    ERROR_TRACKING_ENABLED: parseBooleanFlag(rawEnv.ERROR_TRACKING_ENABLED, false),
    SENTRY_DSN: rawEnv.SENTRY_DSN || '',

    // Persistence: JSON files by default; PostgreSQL is mandatory in production
    // (see validateEnv). Repositories still read/write JSON until T05B.
    PERSISTENCE_DRIVER: parsePersistenceDriver(rawEnv.PERSISTENCE_DRIVER),
    DATABASE_URL: rawEnv.DATABASE_URL,

    // BullMQ uses Redis as its durable transport. Redis is internal-only in
    // Compose; production should use a private redis:// or rediss:// endpoint.
    REDIS_URL: parseRedisUrl(rawEnv.REDIS_URL || rawEnv.QUEUE_REDIS_URL),
    GENERATION_QUEUE_NAME: rawEnv.GENERATION_QUEUE_NAME || 'generation',
    GENERATION_QUEUE_PREFIX: rawEnv.GENERATION_QUEUE_PREFIX || 'aistickers',
    GENERATION_QUEUE_ENABLED: parseBooleanFlag(rawEnv.GENERATION_QUEUE_ENABLED, true),
    GENERATION_QUEUE_CONCURRENCY: parsePositiveInt(rawEnv.GENERATION_QUEUE_CONCURRENCY, 2, 'GENERATION_QUEUE_CONCURRENCY', 32),
    GENERATION_QUEUE_ATTEMPTS: parsePositiveInt(rawEnv.GENERATION_QUEUE_ATTEMPTS, 5, 'GENERATION_QUEUE_ATTEMPTS', 20),
    GENERATION_QUEUE_BACKOFF_MS: parsePositiveInt(rawEnv.GENERATION_QUEUE_BACKOFF_MS, 5000, 'GENERATION_QUEUE_BACKOFF_MS', 300000),
    GENERATION_QUEUE_TIMEOUT_MS: parsePositiveInt(rawEnv.GENERATION_QUEUE_TIMEOUT_MS, 180000, 'GENERATION_QUEUE_TIMEOUT_MS', 3600000),
    GENERATION_QUEUE_STALLED_INTERVAL_MS: parsePositiveInt(rawEnv.GENERATION_QUEUE_STALLED_INTERVAL_MS, 30000, 'GENERATION_QUEUE_STALLED_INTERVAL_MS', 300000),
    GENERATION_QUEUE_LOCK_DURATION_MS: parsePositiveInt(rawEnv.GENERATION_QUEUE_LOCK_DURATION_MS, 240000, 'GENERATION_QUEUE_LOCK_DURATION_MS', 3600000),
    GENERATION_QUEUE_RECONCILE_INTERVAL_MS: parsePositiveInt(rawEnv.GENERATION_QUEUE_RECONCILE_INTERVAL_MS, 30000, 'GENERATION_QUEUE_RECONCILE_INTERVAL_MS', 3600000),
    GENERATION_QUEUE_SHUTDOWN_TIMEOUT_MS: parsePositiveInt(rawEnv.GENERATION_QUEUE_SHUTDOWN_TIMEOUT_MS, 30000, 'GENERATION_QUEUE_SHUTDOWN_TIMEOUT_MS', 300000),
    CLEANUP_QUEUE_NAME: rawEnv.CLEANUP_QUEUE_NAME || 'asset-cleanup',
    CLEANUP_QUEUE_CONCURRENCY: parsePositiveInt(rawEnv.CLEANUP_QUEUE_CONCURRENCY, 2, 'CLEANUP_QUEUE_CONCURRENCY', 16),

    // Private assets use S3-compatible storage in production. Local storage is
    // intentionally restricted to development and tests.
    ASSET_STORAGE_DRIVER: parseAssetStorageDriver(rawEnv.ASSET_STORAGE_DRIVER, isProduction),
    ASSET_STORAGE_BUCKET: rawEnv.ASSET_STORAGE_BUCKET,
    ASSET_STORAGE_PREFIX: rawEnv.ASSET_STORAGE_PREFIX || '',
    ASSET_STORAGE_REGION: rawEnv.ASSET_STORAGE_REGION || 'us-east-1',
    ASSET_STORAGE_ENDPOINT: rawEnv.ASSET_STORAGE_ENDPOINT,
    ASSET_STORAGE_ACCESS_KEY_ID: rawEnv.ASSET_STORAGE_ACCESS_KEY_ID,
    ASSET_STORAGE_SECRET_ACCESS_KEY: rawEnv.ASSET_STORAGE_SECRET_ACCESS_KEY,
    ASSET_STORAGE_FORCE_PATH_STYLE: (rawEnv.ASSET_STORAGE_FORCE_PATH_STYLE || '').trim().toLowerCase() === 'true',
    ASSET_STORAGE_SIGNED_URL_EXPIRY_SECONDS: parsePositiveInt(
      rawEnv.ASSET_STORAGE_SIGNED_URL_EXPIRY_SECONDS,
      300,
      'ASSET_STORAGE_SIGNED_URL_EXPIRY_SECONDS',
      900
    ),
    ASSET_STORAGE_LOCAL_BASE_DIR: rawEnv.ASSET_STORAGE_LOCAL_BASE_DIR || rawEnv.DATA_DIR || '/var/www/aiStickers_Backend/data',

    JWT_SECRET: rawEnv.JWT_SECRET,
    JWT_ISSUER: rawEnv.JWT_ISSUER || 'aiStickers',
    JWT_AUDIENCE: rawEnv.JWT_AUDIENCE || 'aiStickers-backend',
    JWT_EXPIRES_IN: rawEnv.JWT_EXPIRES_IN || '15m',
    REFRESH_TOKEN_EXPIRES_IN_DAYS: 30,

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
    HMAC_LEGACY_V1_ENABLED: parseBooleanFlag(rawEnv.HMAC_LEGACY_V1_ENABLED, !isProduction),

    RATE_LIMIT_WINDOW_SEC: parsePositiveInt(rawEnv.RATE_LIMIT_WINDOW_SEC, 60, 'RATE_LIMIT_WINDOW_SEC', 3600),
    RATE_LIMIT_AUTH_GOOGLE_PER_MINUTE: parsePositiveInt(rawEnv.RATE_LIMIT_AUTH_GOOGLE_PER_MINUTE, 10, 'RATE_LIMIT_AUTH_GOOGLE_PER_MINUTE'),
    RATE_LIMIT_AUTH_TOKEN_PER_MINUTE: parsePositiveInt(rawEnv.RATE_LIMIT_AUTH_TOKEN_PER_MINUTE, 20, 'RATE_LIMIT_AUTH_TOKEN_PER_MINUTE'),
    RATE_LIMIT_PAYMENT_PER_MINUTE: parsePositiveInt(rawEnv.RATE_LIMIT_PAYMENT_PER_MINUTE, 10, 'RATE_LIMIT_PAYMENT_PER_MINUTE'),
    RATE_LIMIT_GENERATION_PER_MINUTE: parsePositiveInt(rawEnv.RATE_LIMIT_GENERATION_PER_MINUTE, 5, 'RATE_LIMIT_GENERATION_PER_MINUTE'),
    RATE_LIMIT_GENERATION_ACTIVE: parsePositiveInt(rawEnv.RATE_LIMIT_GENERATION_ACTIVE, 2, 'RATE_LIMIT_GENERATION_ACTIVE'),
    RATE_LIMIT_UPLOAD_PER_MINUTE: parsePositiveInt(rawEnv.RATE_LIMIT_UPLOAD_PER_MINUTE, 10, 'RATE_LIMIT_UPLOAD_PER_MINUTE'),
    RATE_LIMIT_EXPORT_PER_MINUTE: parsePositiveInt(rawEnv.RATE_LIMIT_EXPORT_PER_MINUTE, 10, 'RATE_LIMIT_EXPORT_PER_MINUTE'),
    RATE_LIMIT_STATUS_PER_MINUTE: parsePositiveInt(rawEnv.RATE_LIMIT_STATUS_PER_MINUTE, 60, 'RATE_LIMIT_STATUS_PER_MINUTE'),

    TELEGRAM_BOT_TOKEN: rawEnv.TELEGRAM_BOT_TOKEN,

    ENABLE_APPLE_PAYMENTS: parseBooleanFlag(rawEnv.ENABLE_APPLE_PAYMENTS, false),
    ENABLE_TELEGRAM: parseBooleanFlag(rawEnv.ENABLE_TELEGRAM, false),
    ENABLE_WHATSAPP_EXPORT: parseBooleanFlag(rawEnv.ENABLE_WHATSAPP_EXPORT, false),
    ENABLE_EXTERNAL_IMAGE_URLS: parseBooleanFlag(rawEnv.ENABLE_EXTERNAL_IMAGE_URLS, false),
    ENABLE_TEST_JWTS: parseBooleanFlag(rawEnv.ENABLE_TEST_JWTS, false),

    EXTERNAL_IMAGE_URL_ALLOWLIST: parseHostAllowlist(rawEnv.EXTERNAL_IMAGE_URL_ALLOWLIST),

    CORS_ORIGINS: null,
    TEST_JWTS: []
  };

  config.CORS_ORIGINS = parseCorsOrigins(rawEnv.CORS_ORIGINS, isProduction);

  // If a DATABASE_URL is provided (development testing or production) it must
  // be a well-formed PostgreSQL connection string, regardless of driver.
  if (config.DATABASE_URL && config.DATABASE_URL.trim() !== '') {
    if (!/^postgres(ql)?:\/\//.test(config.DATABASE_URL)) {
      throw new Error('DATABASE_URL must be a postgresql:// connection string');
    }
  }

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

  if (JSON.stringify(config).includes('CHANGE_ME')) {
    throw new Error('Production configuration must not contain CHANGE_ME');
  }

  if (config.HMAC_LEGACY_V1_ENABLED) {
    throw new Error('HMAC_LEGACY_V1_ENABLED must be false in production');
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

  if (config.PERSISTENCE_DRIVER !== 'postgres') {
    throw new Error("PERSISTENCE_DRIVER must be 'postgres' in production");
  }
  requireString('DATABASE_URL', 1);

  if (config.ASSET_STORAGE_DRIVER !== 's3') {
    throw new Error("ASSET_STORAGE_DRIVER must be 's3' in production");
  }
  requireString('ASSET_STORAGE_BUCKET', 1);
  requireString('ASSET_STORAGE_REGION', 1);
  requireString('ASSET_STORAGE_ACCESS_KEY_ID', 1);
  requireString('ASSET_STORAGE_SECRET_ACCESS_KEY', 8);

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

  if (!isValidGooglePlayServiceAccount(config.GOOGLE_PLAY_SERVICE_ACCOUNT)) {
    throw new Error(
      'GOOGLE_PLAY_SERVICE_ACCOUNT must be valid JSON with type=service_account, project_id, client_email and private_key in production'
    );
  }

  if (config.ENABLE_APPLE_PAYMENTS) {
    requireString('APPLE_CLIENT_ID', 1);
  }

  if (config.ENABLE_TELEGRAM) {
    requireString('TELEGRAM_BOT_TOKEN', 1);
  }

  if (config.METRICS_ENABLED) {
    requireString('METRICS_BEARER_TOKEN', 16);
    if (config.METRICS_BEARER_TOKEN === config.CLIENT_SECRET) {
      throw new Error('METRICS_BEARER_TOKEN must not be the same as CLIENT_SECRET');
    }
  }

  if (config.ERROR_TRACKING_ENABLED) {
    requireString('SENTRY_DSN', 1);
  }
}

export const env = loadConfig();

import { LocalAssetStorage } from '../../infrastructure/storage/local-asset-storage.js';
import { S3AssetStorage } from '../../infrastructure/storage/s3-asset-storage.js';

const VALID_STORAGE_DRIVERS = ['local', 's3'];

function parseDriver(value) {
  if (!value || value.trim() === '') return 'local';
  const driver = value.trim().toLowerCase();
  if (!VALID_STORAGE_DRIVERS.includes(driver)) {
    throw new Error(`ASSET_STORAGE_DRIVER must be one of: ${VALID_STORAGE_DRIVERS.join(', ')}`);
  }
  return driver;
}

function parseIntSeconds(value, defaultValue) {
  if (!value || value.trim() === '') return defaultValue;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1 || n > 900) {
    throw new Error(`Invalid integer value: ${value}`);
  }
  return n;
}

export function buildStorageConfig(rawEnv = process.env) {
  const nodeEnv = rawEnv.NODE_ENV || 'development';
  const driver = parseDriver(rawEnv.ASSET_STORAGE_DRIVER);

  if (nodeEnv === 'production' && driver !== 's3') {
    throw new Error("ASSET_STORAGE_DRIVER must be 's3' in production");
  }

  return {
    driver,
    bucket: rawEnv.ASSET_STORAGE_BUCKET || 'aistickers-private-assets',
    prefix: (rawEnv.ASSET_STORAGE_PREFIX || '').replace(/\/$/, ''),
    region: rawEnv.ASSET_STORAGE_REGION || 'us-east-1',
    endpoint: rawEnv.ASSET_STORAGE_ENDPOINT || undefined,
    accessKeyId: rawEnv.ASSET_STORAGE_ACCESS_KEY_ID || undefined,
    secretAccessKey: rawEnv.ASSET_STORAGE_SECRET_ACCESS_KEY || undefined,
    forcePathStyle: (rawEnv.ASSET_STORAGE_FORCE_PATH_STYLE || '').trim().toLowerCase() === 'true',
    signedUrlExpirySeconds: parseIntSeconds(rawEnv.ASSET_STORAGE_SIGNED_URL_EXPIRY_SECONDS, 300),
    localBaseDir: rawEnv.ASSET_STORAGE_LOCAL_BASE_DIR || rawEnv.DATA_DIR || '/var/www/aiStickers_Backend/data'
  };
}

/**
 * Build the configured AssetStorage implementation.
 *
 * The global env object is intentionally not read during import; this allows
 * tests to override process.env before the storage is created.
 */
export function createAssetStorage(config = buildStorageConfig()) {
  if (config.driver === 's3') {
    return new S3AssetStorage({
      endpoint: config.endpoint,
      region: config.region,
      bucket: config.bucket,
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
      forcePathStyle: config.forcePathStyle,
      prefix: config.prefix
    });
  }

  return new LocalAssetStorage({
    baseDir: config.localBaseDir,
    bucket: config.bucket
  });
}

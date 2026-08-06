import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { parseTestJwts, buildConfig, validateEnv } from '../../src/config/env.js';

describe('parseTestJwts', () => {
  it('returns an empty array for undefined or empty values', () => {
    expect(parseTestJwts(undefined)).toEqual([]);
    expect(parseTestJwts('')).toEqual([]);
    expect(parseTestJwts('   ')).toEqual([]);
  });

  it('returns an empty array for invalid JSON', () => {
    expect(parseTestJwts('not-json')).toEqual([]);
  });

  it('returns an empty array for non-array JSON', () => {
    expect(parseTestJwts('{"token":"abc"}')).toEqual([]);
  });

  it('returns only non-empty string entries', () => {
    const input = JSON.stringify(['valid.token', '', 123, null, '   ', 'another.token']);
    expect(parseTestJwts(input)).toEqual(['valid.token', 'another.token']);
  });
});

describe('buildConfig and validateEnv', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    for (const key of Object.keys(process.env)) {
      delete process.env[key];
    }
  });

  afterEach(() => {
    for (const key of Object.keys(process.env)) {
      delete process.env[key];
    }
    Object.assign(process.env, originalEnv);
  });

  function setProductionEnv(extra = {}) {
    process.env.NODE_ENV = 'production';
    process.env.PORT = '2002';
    process.env.JWT_SECRET = 'production-jwt-secret-with-32-chars-long!!';
    process.env.CLIENT_SECRET = 'production-client-secret-32-chars-long!!';
    process.env.CLIENT_ID = 'ai-stickers-prod';
    process.env.GOOGLE_PACKAGE_NAME = 'com.animatedsticker.aistickers';
    process.env.GOOGLE_CLIENT_ID = 'google-client-id';
    process.env.GOOGLE_CLIENT_SECRET = 'google-client-secret-16';
    process.env.REPLICATE_API_TOKEN = 'replicate-token';
    process.env.REPLICATE_MODEL = 'google/nano-banana';
    process.env.REPLICATE_IMG2VID_MODEL = 'bytedance/seedance-1-pro';
    process.env.GOOGLE_PLAY_SERVICE_ACCOUNT = JSON.stringify({ type: 'service_account' });
    process.env.CORS_ORIGINS = 'https://app.example.com';
    process.env.PERSISTENCE_DRIVER = 'postgres';
    process.env.DATABASE_URL = 'postgresql://user:pass@localhost:5432/aistickers';
    process.env.ASSET_STORAGE_DRIVER = 's3';
    process.env.ASSET_STORAGE_BUCKET = 'aistickers-private-assets';
    process.env.ASSET_STORAGE_REGION = 'us-east-1';
    process.env.ASSET_STORAGE_ACCESS_KEY_ID = 'prod-access-key';
    process.env.ASSET_STORAGE_SECRET_ACCESS_KEY = 'prod-secret-key-min-8';
    Object.assign(process.env, extra);
  }

  it('development can start with optional secrets missing and features off', () => {
    process.env.NODE_ENV = 'development';
    process.env.JWT_SECRET = 'dev-jwt-secret-minimum-32-chars-long';
    process.env.CLIENT_SECRET = 'dev-client-secret-minimum-32-chars';

    const config = buildConfig();
    expect(() => validateEnv(config)).not.toThrow();
    expect(config.ENABLE_APPLE_PAYMENTS).toBe(false);
    expect(config.ENABLE_TELEGRAM).toBe(false);
    expect(config.ENABLE_WHATSAPP_EXPORT).toBe(false);
    expect(config.ENABLE_EXTERNAL_IMAGE_URLS).toBe(false);
    expect(config.ENABLE_TEST_JWTS).toBe(false);
    expect(config.CORS_ORIGINS).toBe('*');
  });

  it('production validates all critical secrets', () => {
    setProductionEnv();
    const config = buildConfig();
    expect(() => validateEnv(config)).not.toThrow();
  });

  const requiredSecrets = [
    'JWT_SECRET',
    'CLIENT_SECRET',
    'CLIENT_ID',
    'GOOGLE_PACKAGE_NAME',
    'GOOGLE_CLIENT_ID',
    'GOOGLE_CLIENT_SECRET',
    'REPLICATE_API_TOKEN',
    'REPLICATE_MODEL',
    'REPLICATE_IMG2VID_MODEL',
    'GOOGLE_PLAY_SERVICE_ACCOUNT'
  ];

  for (const secret of requiredSecrets) {
    it(`production fails when ${secret} is missing`, () => {
      setProductionEnv();
      delete process.env[secret];
      const config = buildConfig();
      expect(() => validateEnv(config)).toThrow();
    });
  }

  it('development defaults PERSISTENCE_DRIVER to json without requiring DATABASE_URL', () => {
    process.env.NODE_ENV = 'development';
    process.env.JWT_SECRET = 'dev-jwt-secret-minimum-32-chars-long';
    process.env.CLIENT_SECRET = 'dev-client-secret-minimum-32-chars';

    const config = buildConfig();
    expect(config.PERSISTENCE_DRIVER).toBe('json');
    expect(config.DATABASE_URL).toBeUndefined();
    expect(() => validateEnv(config)).not.toThrow();
  });

  it('rejects an unknown PERSISTENCE_DRIVER value', () => {
    process.env.NODE_ENV = 'development';
    process.env.JWT_SECRET = 'dev-jwt-secret-minimum-32-chars-long';
    process.env.CLIENT_SECRET = 'dev-client-secret-minimum-32-chars';
    process.env.PERSISTENCE_DRIVER = 'mongo';

    expect(() => buildConfig()).toThrow('PERSISTENCE_DRIVER');
  });

  it('rejects a malformed DATABASE_URL regardless of environment', () => {
    process.env.NODE_ENV = 'development';
    process.env.JWT_SECRET = 'dev-jwt-secret-minimum-32-chars-long';
    process.env.CLIENT_SECRET = 'dev-client-secret-minimum-32-chars';
    process.env.DATABASE_URL = 'mysql://user:pass@localhost:3306/db';

    expect(() => buildConfig()).toThrow('DATABASE_URL');
  });

  it('production requires PERSISTENCE_DRIVER=postgres', () => {
    setProductionEnv({ PERSISTENCE_DRIVER: 'json' });
    const config = buildConfig();
    expect(() => validateEnv(config)).toThrow('PERSISTENCE_DRIVER');
  });

  it('production requires DATABASE_URL', () => {
    setProductionEnv();
    delete process.env.DATABASE_URL;
    const config = buildConfig();
    expect(() => validateEnv(config)).toThrow('DATABASE_URL');
  });

  it('production rejects local asset storage', () => {
    setProductionEnv({ ASSET_STORAGE_DRIVER: 'local' });
    const config = buildConfig();
    expect(() => validateEnv(config)).toThrow('ASSET_STORAGE_DRIVER');
  });

  it('limits signed asset URLs to 15 minutes', () => {
    process.env.NODE_ENV = 'development';
    process.env.ASSET_STORAGE_SIGNED_URL_EXPIRY_SECONDS = '901';
    expect(() => buildConfig()).toThrow('ASSET_STORAGE_SIGNED_URL_EXPIRY_SECONDS');
  });

  it('production rejects an invalid GOOGLE_PLAY_SERVICE_ACCOUNT JSON', () => {
    const invalidServiceAccount = 'not-json';
    setProductionEnv({ GOOGLE_PLAY_SERVICE_ACCOUNT: invalidServiceAccount });
    const config = buildConfig();
    expect(() => validateEnv(config)).toThrow('GOOGLE_PLAY_SERVICE_ACCOUNT');
  });

  it('production requires CORS_ORIGINS', () => {
    setProductionEnv();
    delete process.env.CORS_ORIGINS;
    expect(() => buildConfig()).toThrow('CORS_ORIGINS');
  });

  it('production rejects short secrets', () => {
    const shortSecret = 'short';
    setProductionEnv({ JWT_SECRET: shortSecret });
    const config = buildConfig();
    expect(() => validateEnv(config)).toThrow('JWT_SECRET');
  });

  it('production rejects invalid PORT', () => {
    setProductionEnv({ PORT: '99999' });
    expect(() => buildConfig()).toThrow('PORT');
  });

  it('production rejects TEST_JWTS even if the flag is enabled', () => {
    setProductionEnv({ ENABLE_TEST_JWTS: 'true', TEST_JWTS: '["eyJhbGciOiJIUzI1NiJ9.test"]' });
    expect(() => buildConfig()).toThrow('TEST_JWTS');
  });

  it('requires APPLE_CLIENT_ID when ENABLE_APPLE_PAYMENTS is true in production', () => {
    setProductionEnv({ ENABLE_APPLE_PAYMENTS: 'true' });
    delete process.env.APPLE_CLIENT_ID;
    const config = buildConfig();
    expect(() => validateEnv(config)).toThrow('APPLE_CLIENT_ID');
  });

  it('requires TELEGRAM_BOT_TOKEN when ENABLE_TELEGRAM is true in production', () => {
    setProductionEnv({ ENABLE_TELEGRAM: 'true' });
    delete process.env.TELEGRAM_BOT_TOKEN;
    const config = buildConfig();
    expect(() => validateEnv(config)).toThrow('TELEGRAM_BOT_TOKEN');
  });

  it('parses boolean flags', () => {
    process.env.NODE_ENV = 'development';
    process.env.ENABLE_APPLE_PAYMENTS = 'true';
    process.env.ENABLE_TELEGRAM = '1';
    process.env.ENABLE_WHATSAPP_EXPORT = 'yes';
    process.env.ENABLE_EXTERNAL_IMAGE_URLS = 'on';
    process.env.ENABLE_TEST_JWTS = 'false';

    const config = buildConfig();
    expect(config.ENABLE_APPLE_PAYMENTS).toBe(true);
    expect(config.ENABLE_TELEGRAM).toBe(true);
    expect(config.ENABLE_WHATSAPP_EXPORT).toBe(true);
    expect(config.ENABLE_EXTERNAL_IMAGE_URLS).toBe(true);
    expect(config.ENABLE_TEST_JWTS).toBe(false);
  });
});

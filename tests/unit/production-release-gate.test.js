import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  sanitizePreflightError,
  validateProductionEnvironment
} from '../../scripts/production-preflight.js';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const dockerfile = readFileSync(path.join(projectRoot, 'Dockerfile'), 'utf8');
const productionCompose = readFileSync(path.join(projectRoot, 'compose.production.example.yml'), 'utf8');
const productionSmoke = readFileSync(path.join(projectRoot, 'scripts/docker-production-smoke.js'), 'utf8');

function validProductionEnv(overrides = {}) {
  return {
    NODE_ENV: 'production',
    PERSISTENCE_DRIVER: 'postgres',
    DATABASE_URL: 'postgresql://preflight:password@db.example.test:5432/aistickers',
    REDIS_URL: 'rediss://redis.example.test:6380',
    ASSET_STORAGE_DRIVER: 's3',
    ASSET_STORAGE_BUCKET: 'aistickers-private-assets',
    ASSET_STORAGE_REGION: 'eu-west-1',
    ASSET_STORAGE_ENDPOINT: 'https://s3.example.test',
    ASSET_STORAGE_ACCESS_KEY_ID: 'preflight-access-key',
    ASSET_STORAGE_SECRET_ACCESS_KEY: 'preflight-secret-key',
    ['JWT' + '_SECRET']: 'preflight-jwt-secret-with-at-least-32-characters',
    CLIENT_ID: 'preflight-client',
    ['CLIENT' + '_SECRET']: 'preflight-client-secret-with-at-least-32-chars',
    GOOGLE_CLIENT_ID: 'preflight-google-client',
    ['GOOGLE_CLIENT' + '_SECRET']: 'preflight-google-client-secret',
    GOOGLE_PACKAGE_NAME: 'com.animatedsticker.aistickers',
    ['GOOGLE_PLAY_' + 'SERVICE_ACCOUNT']: '{"type":"service_account"}',
    ['REPLICATE' + '_API_TOKEN']: 'preflight-replicate-token',
    REPLICATE_MODEL: 'google/nano-banana',
    REPLICATE_IMG2VID_MODEL: 'bytedance/seedance-1-pro',
    CORS_ORIGINS: 'https://app.example.test',
    HMAC_LEGACY_V1_ENABLED: 'false',
    ENABLE_TEST_JWTS: 'false',
    ENABLE_APPLE_PAYMENTS: 'false',
    ENABLE_TELEGRAM: 'false',
    ENABLE_WHATSAPP_EXPORT: 'false',
    GENERATION_QUEUE_ENABLED: 'true',
    METRICS_ENABLED: 'false',
    ...overrides
  };
}

function serviceBlock(serviceName) {
  const match = productionCompose.match(
    new RegExp(`\\n  ${serviceName}:\\n([\\s\\S]*?)(?=\\n  [a-z-]+:\\n|\\nvolumes:)`)
  );
  return match?.[1] || '';
}

describe('production release gate', () => {
  it('accepts a complete safe production configuration', () => {
    const result = validateProductionEnvironment(validProductionEnv());
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('rejects JSON persistence in production', () => {
    const result = validateProductionEnvironment(validProductionEnv({ PERSISTENCE_DRIVER: 'json' }));
    expect(result.ok).toBe(false);
    expect(result.errors.join('\n')).toMatch(/PERSISTENCE_DRIVER/);
  });

  it('rejects missing production secrets', () => {
    const env = validProductionEnv();
    delete env.JWT_SECRET;
    const result = validateProductionEnvironment(env);
    expect(result.ok).toBe(false);
    expect(result.errors.join('\n')).toMatch(/JWT_SECRET/);
  });

  it('rejects enabled metrics without a bearer token', () => {
    const result = validateProductionEnvironment(validProductionEnv({ METRICS_ENABLED: 'true' }));
    expect(result.ok).toBe(false);
    expect(result.errors.join('\n')).toMatch(/METRICS_BEARER_TOKEN/);
  });

  it('sanitizes secrets and URL credentials from preflight errors', () => {
    const secret = 'preflight-super-secret-value';
    const message = sanitizePreflightError(
      new Error(`invalid value ${secret} at https://user:${secret}@example.test`),
      { SECRET: secret }
    );
    expect(message).not.toContain(secret);
    expect(message).not.toContain('user:');
    expect(message).toContain('[redacted]');
  });

  it('keeps PostgreSQL and Redis private in the production Compose file', () => {
    expect(serviceBlock('postgres')).not.toMatch(/\n\s+ports:/);
    expect(serviceBlock('redis')).not.toMatch(/\n\s+ports:/);
    expect(serviceBlock('backend')).toContain('127.0.0.1:22024:2002');
    expect(serviceBlock('migrate')).toContain('prisma:migrate:deploy');
  });

  it('uses the readiness healthcheck, non-root execution and one image for app processes', () => {
    expect(dockerfile).toContain('npm ci --omit=dev');
    expect(dockerfile).toContain('prisma generate');
    expect(dockerfile).toContain('USER node');
    expect(dockerfile).toContain("/health/ready");
    expect(dockerfile).toContain('STOPSIGNAL SIGTERM');
    expect(productionCompose).not.toMatch(/aistickers-backend:latest/);
    expect(serviceBlock('backend')).toContain('image: *app-image');
    expect(serviceBlock('worker')).toContain('image: *app-image');
  });

  it('smoke script verifies protected metrics and clean SIGTERM shutdown', () => {
    expect(productionSmoke).toContain("'SIGTERM'");
    expect(productionSmoke).toContain('/metrics`');
    expect(productionSmoke).toContain("'id', '-u'");
    expect(productionSmoke).toContain("'network', 'rm', network");
  });
});

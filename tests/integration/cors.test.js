import { describe, it, expect } from 'vitest';
import request from 'supertest';

const TEST_JWT_SECRET = 'production-jwt-secret-with-32-chars-long!!';
const TEST_CLIENT_SECRET = 'production-client-secret-32-chars-long!!';

function setProductionEnv() {
  process.env.NODE_ENV = 'production';
  process.env.PORT = '22024';
  process.env.JWT_SECRET = TEST_JWT_SECRET;
  process.env.CLIENT_SECRET = TEST_CLIENT_SECRET;
  process.env.CLIENT_ID = 'ai-stickers-prod';
  process.env.GOOGLE_PACKAGE_NAME = 'com.animatedsticker.aistickers';
  process.env.GOOGLE_CLIENT_ID = 'google-client-id';
  process.env.GOOGLE_CLIENT_SECRET = 'google-client-secret-16';
  process.env.REPLICATE_API_TOKEN = 'replicate-token';
  process.env.REPLICATE_MODEL = 'google/nano-banana';
  process.env.REPLICATE_IMG2VID_MODEL = 'bytedance/seedance-1-pro';
  process.env.GOOGLE_PLAY_SERVICE_ACCOUNT = JSON.stringify({ type: 'service_account' });
  process.env.CORS_ORIGINS = 'https://allowed.example.com,https://app.example.com';
  process.env.PERSISTENCE_DRIVER = 'postgres';
  process.env.DATABASE_URL = 'postgresql://user:pass@localhost:5432/aistickers';
  process.env.ASSET_STORAGE_DRIVER = 's3';
  process.env.ASSET_STORAGE_BUCKET = 'aistickers-private-assets';
  process.env.ASSET_STORAGE_REGION = 'us-east-1';
  process.env.ASSET_STORAGE_ACCESS_KEY_ID = 'prod-access-key';
  process.env.ASSET_STORAGE_SECRET_ACCESS_KEY = 'prod-secret-key-min-8';
  process.env.ASSET_STORAGE_ENDPOINT = 'http://localhost:9000';
}

describe('CORS in production', () => {
  it('allows a configured origin and rejects an unknown one', async () => {
    setProductionEnv();

    const { buildTestApp } = await import('../helpers/app.js');
    const ctx = await buildTestApp();

    try {
      const allowed = await request(ctx.app)
        .get('/health')
        .set('Origin', 'https://app.example.com');
      expect(allowed.status).toBe(200);
      expect(allowed.headers['access-control-allow-origin']).toBe('https://app.example.com');

      const denied = await request(ctx.app)
        .get('/health')
        .set('Origin', 'https://evil.example.com');
      expect(denied.status).toBe(500);
    } finally {
      ctx.cleanup();
    }
  }, 30000);
});

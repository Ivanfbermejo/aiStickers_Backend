import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    hookTimeout: 30000,
    env: {
      NODE_ENV: 'test',
      PORT: '2002',
      JWT_SECRET: process.env.JWT_SECRET ?? 'test_jwt_secret_minimum_32_chars_long',
      JWT_ISSUER: 'aiStickers-test',
      JWT_AUDIENCE: 'aiStickers-backend-test',
      JWT_EXPIRES_IN: '1h',
      CLIENT_ID: process.env.CLIENT_ID ?? 'ai-stickers-test',
      CLIENT_SECRET: process.env.CLIENT_SECRET ?? 'test_client_secret_minimum_32_chars',
      TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN ?? 'test-token',
      GOOGLE_PACKAGE_NAME: 'com.animatedsticker.aistickers',
      REPLICATE_MODEL: 'google/nano-banana',
      REPLICATE_IMG2VID_MODEL: 'bytedance/seedance-1-pro',
      GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID ?? '',
      GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET ?? '',
      ENABLE_APPLE_PAYMENTS: 'false',
      ENABLE_TELEGRAM: 'false',
      ENABLE_WHATSAPP_EXPORT: 'false',
      ENABLE_EXTERNAL_IMAGE_URLS: 'false',
      ENABLE_TEST_JWTS: 'false',
      CORS_ORIGINS: '*'
    }
  }
});

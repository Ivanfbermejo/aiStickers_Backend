import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load .env file
dotenv.config({ path: path.join(__dirname, '../../.env') });

/**
 * Environment Configuration
 * Centralizes all environment variables
 */
export const env = {
  // Server
  PORT: process.env.PORT || 22024,
  NODE_ENV: process.env.NODE_ENV || 'development',
  
  // JWT
  JWT_SECRET: process.env.JWT_SECRET,
  JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN || '24h',
  
  // Google Auth
  GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET,
  GOOGLE_PACKAGE_NAME: process.env.GOOGLE_PACKAGE_NAME || 'com.animatedsticker.aistickers',
  
  // Apple Auth
  APPLE_CLIENT_ID: process.env.APPLE_CLIENT_ID,
  
  // HMAC (App Authentication)
  CLIENT_ID: process.env.CLIENT_ID || 'ai-stickers',
  CLIENT_SECRET: process.env.CLIENT_SECRET,
  
  // Data
  DATA_DIR: process.env.DATA_DIR || '/var/www/aiStickers_Backend/data',
  
  // Google Play
  GOOGLE_PLAY_SERVICE_ACCOUNT: process.env.GOOGLE_PLAY_SERVICE_ACCOUNT,

  // i18n / POEditor
  POEDITOR_API_TOKEN: process.env.POEDITOR_API_TOKEN,
  POEDITOR_PROJECT_ID: process.env.POEDITOR_PROJECT_ID,

  // Replicate AI
  REPLICATE_API_TOKEN: process.env.REPLICATE_API_TOKEN,
  REPLICATE_MODEL: process.env.REPLICATE_MODEL || "google/nano-banana",
  REPLICATE_IMG2VID_MODEL: process.env.REPLICATE_IMG2VID_MODEL || "bytedance/seedance-1-pro",

  // HMAC window
  SIG_WINDOW_SEC: Number(process.env.SIG_WINDOW_SEC || 300),

  // Telegram Bot
  TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN
};

// Validation
export function validateEnv() {
  const required = ['JWT_SECRET', 'CLIENT_SECRET', 'TELEGRAM_BOT_TOKEN'];
  const missing = required.filter(key => !env[key]);
  
  if (missing.length > 0) {
    console.warn(`⚠️  Missing environment variables: ${missing.join(', ')}`);
    console.warn('   Using default values for development');
  }
}

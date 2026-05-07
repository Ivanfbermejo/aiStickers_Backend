// src/utils/env.js
import { config } from "dotenv";
import { fileURLToPath } from "url";
import path from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const envPath = path.resolve(__dirname, "../../.env");

// Cargar .env de forma explícita
const r = config({ path: envPath });
console.log("[ENV] loaded:", envPath, "ok:", !r.error);

// Helper: lee y hace trim
const get = (k, required = false) => {
  const v = process.env[k];
  const trimmed = typeof v === "string" ? v.trim() : v;
  if (required && (!trimmed || trimmed === "")) {
    console.warn(`[ENV] Missing ${k}`);
  }
  return trimmed;
};

const env = {
  // Supabase
  SUPABASE_URL: get("SUPABASE_URL", true),
  SUPABASE_SERVICE_ROLE_KEY: get("SUPABASE_SERVICE_ROLE_KEY", true),
  SUPABASE_BUCKET: get("SUPABASE_BUCKET") || "photos",

  // Replicate
  REPLICATE_API_TOKEN: get("REPLICATE_API_TOKEN", true),
  REPLICATE_MODEL: get("REPLICATE_MODEL") || "google/nano-banana",

  // Auth / HMAC
  CLIENT_ID: get("CLIENT_ID", true),
  CLIENT_SECRET: get("CLIENT_SECRET"),
  SIG_WINDOW_SEC: Number(get("SIG_WINDOW_SEC") || 300),

  // JWT
  APP_KEY: get("APP_KEY"),
  JWT_SECRET: get("JWT_SECRET", true),
  JWT_EXPIRES_IN: get("JWT_EXPIRES_IN") || "15m",

  PORT: Number(get("PORT") || 3000),
  PUBLIC_BASE_URL: get("PUBLIC_BASE_URL") || "",

  // POEditor i18n
  POEDITOR_API_TOKEN: get("POEDITOR_API_TOKEN", true),
  POEDITOR_PROJECT_ID: get("POEDITOR_PROJECT_ID", true),

  // PaymentCore
  GOOGLE_PLAY_PUBLIC_KEY: get("GOOGLE_PLAY_PUBLIC_KEY"),
  GOOGLE_SERVICE_ACCOUNT_PATH: get("GOOGLE_SERVICE_ACCOUNT_PATH"),
  GOOGLE_PLAY_PACKAGE_NAME: get("GOOGLE_PLAY_PACKAGE_NAME"),
  APPLE_APP_STORE_SECRET: get("APPLE_APP_STORE_SECRET"),
  PAYMENT_ENCRYPTION_KEY: get("PAYMENT_ENCRYPTION_KEY"),

  // Social Authentication
  GOOGLE_CLIENT_ID: get("GOOGLE_CLIENT_ID", true),
  GOOGLE_ANDROID_CLIENT_ID: get("GOOGLE_ANDROID_CLIENT_ID"),
  GOOGLE_ANDROID_DEBUG_CLIENT_ID: get("GOOGLE_ANDROID_DEBUG_CLIENT_ID"),
  APPLE_CLIENT_ID: get("APPLE_CLIENT_ID", true),

  // Mock Services
  ENABLE_MOCK: get("ENABLE_MOCK"),
  ENABLE_DEVELOPMENT_LOGS: get("ENABLE_DEVELOPMENT_LOGS"),
};

console.log("[ENV] CLIENT_ID=", JSON.stringify(env.CLIENT_ID));

export default env;
export { env };
export const ENV = env;

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
};

console.log("[ENV] CLIENT_ID=", JSON.stringify(env.CLIENT_ID));

export default env;
export { env };
export const ENV = env;

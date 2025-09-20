// src/utils/env.js
import "dotenv/config";

function num(v, d) { const n = Number(v); return Number.isFinite(n) ? n : d; }

const env = {
  NODE_ENV: process.env.NODE_ENV || "production",

  // AUTH
  JWT_SECRET: process.env.JWT_SECRET,
  JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN || "10m",

  // HMAC opcional
  CLIENT_ID: process.env.CLIENT_ID,
  CLIENT_SECRET: process.env.CLIENT_SECRET,
  SIG_WINDOW_SEC: num(process.env.SIG_WINDOW_SEC, 300),

  // SUPABASE (ajusta a lo que uses)
  SUPABASE_URL: process.env.SUPABASE_URL,
  SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY,
  SUPABASE_SERVICE_ROLE: process.env.SUPABASE_SERVICE_ROLE,
  SUPABASE_BUCKET: process.env.SUPABASE_BUCKET || "photos",
};

if (!env.JWT_SECRET) throw new Error("JWT_SECRET no definido");

export default env;
export { env };
// 👇 compatibilidad con imports antiguos `{ ENV }`
export const ENV = env;

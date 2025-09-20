// src/utils/env.js
import { config } from "dotenv";
import { fileURLToPath } from "url";
import path from "path";

// Carga .env desde la raíz del proyecto (aiStickers_Backend/.env)
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
config({ path: path.resolve(__dirname, "../../.env") });

function req(name) {
  const v = process.env[name];
  if (!v || v.trim() === "") throw new Error(`${name} no definido en .env`);
  return v;
}

const env = {
  SUPABASE_URL: req("SUPABASE_URL"),
  SUPABASE_SERVICE_ROLE_KEY: req("SUPABASE_SERVICE_ROLE_KEY"),
  SUPABASE_BUCKET: process.env.SUPABASE_BUCKET || "photos",

  REPLICATE_API_TOKEN: req("REPLICATE_API_TOKEN"),

  APP_KEY: req("APP_KEY"),
  JWT_SECRET: req("JWT_SECRET"),
  JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN || "15m",
};

export default env;
export { env };
export const ENV = env; // compat

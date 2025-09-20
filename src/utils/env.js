// Carga variables de .env (Railway ya las inyecta, esto solo ayuda en local)
import "dotenv/config";

function num(v, d) { const n = Number(v); return Number.isFinite(n) ? n : d; }

const env = {
  NODE_ENV: process.env.NODE_ENV || "production",

  // Auth / seguridad
  JWT_SECRET: process.env.JWT_SECRET,                 // <-- obligatorio
  JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN || "10m",
  APP_KEY: process.env.APP_KEY,                       // si lo usas
  CLIENT_ID: process.env.CLIENT_ID,                   // si usas HMAC
  CLIENT_SECRET: process.env.CLIENT_SECRET,           // si usas HMAC
  SIG_WINDOW_SEC: num(process.env.SIG_WINDOW_SEC, 300),

  // añade aquí lo que ya uses (SUPABASE_URL, etc.) si procede
};

// Validación mínima (evita arrancar sin secreto)
if (!env.JWT_SECRET) {
  throw new Error("JWT_SECRET no definido en variables de entorno");
}

export default env;
export { env };

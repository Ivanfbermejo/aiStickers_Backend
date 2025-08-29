import express from "express";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();

app.use(express.json());

// --- Variables de entorno ---
const {
  SUPABASE_URL,
  SUPABASE_ANON_KEY,
  PORT = 8080,
  PUBLIC_BASE_URL = "http://localhost:8080"
} = process.env;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.warn("⚠️ Faltan SUPABASE_URL o SUPABASE_ANON_KEY en variables de entorno");
}

// --- Salud ---
app.get("/health", (_, res) => res.json({ ok: true }));

/**
 * POST /auth/signup
 * Body: { email, password, redirect_to? }
 * Crea usuario en Supabase y fuerza el redirect de confirmación al callback público.
 */
app.post("/auth/signup", async (req, res) => {
  try {
    const { email, password, redirect_to } = req.body || {};
    if (!email || !password) {
      return res.status(400).json({ error: "email y password son obligatorios" });
    }
    // URL de retorno: lo que pase el cliente o por defecto nuestro callback público
    const callback = redirect_to || `${PUBLIC_BASE_URL}/auth/callback`;

    const url = `${SUPABASE_URL}/auth/v1/signup`;
    const r = await fetch(url, {
      method: "POST",
      headers: {
        "apikey": SUPABASE_ANON_KEY,
        "Authorization": `Bearer ${SUPABASE_ANON_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        email,
        password,
        redirect_to: callback
      })
    });

    const data = await r.json();
    if (!r.ok) {
      return res.status(r.status).json({ error: data?.msg || data?.error_description || "signup failed", raw: data });
    }
    // Devuelve lo que responde Supabase (user/session). Si confirmación de email está ON, session suele venir null.
    res.json(data);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "internal error" });
  }
});

app.use(
  "/auth",
  express.static(path.join(__dirname, "public/auth"), {
    extensions: ["html"], // /auth/callback => callback.html
    index: false
  })
);

// --- Arranque ---
app.listen(PORT, () => {
  console.log(`✅ API running on :${PORT}`);
});

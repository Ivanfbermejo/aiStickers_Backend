import express from "express";
import helmet from "helmet";
import { AIController } from "./src/controllers/ai.controller.js";
import { auth } from "./src/middlewares/auth.middleware.js";
import { AuthService } from "./src/services/auth.service.js";

const app = express();
app.use(helmet());
app.use(express.json({ limit: "5mb" }));

// Salud para verificar que NO es 502 por caída
app.get("/health", (_req, res) => res.json({ ok: true }));

// === Emisión de token por X-App-Key (simple) ===
app.post("/auth/token", (req, res) => {
  const key = req.header("X-App-Key");
  if (!key || key !== process.env.APP_KEY) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  const token = AuthService.sign({ sub: "ivan", scope: ["stickers"] });
  return res.json({ token, expiresIn: process.env.JWT_EXPIRES_IN || "15m" });
});

// === Rutas protegidas ===
app.post("/upload-url", auth, AIController.uploadUrl);
app.post("/process",    auth, AIController.process);

// Manejo de errores para evitar 502 silenciosos
app.use((err, _req, res, _next) => {
  console.error("UNCAUGHT:", err);
  res.status(500).json({ error: "internal error" });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`API on :${PORT}`));

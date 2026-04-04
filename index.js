import express from "express";
import helmet from "helmet";
import cors from "cors";
import env from "./src/utils/env.js";
import { AuthService } from "./src/services/auth.service.js";
import { auth } from "./src/middlewares/auth.middleware.js";
import { requireClientSignature } from "./src/middlewares/clientSign.middleware.js";

const app = express();

// Logs detallados para development
if (process.env.NODE_ENV === 'development' || process.env.ENABLE_DEVELOPMENT_LOGS === 'true') {
  console.log("🔍 Development logs enabled");
  
  app.use((req, res, next) => {
    const timestamp = new Date().toISOString();
    console.log(`📝 [${timestamp}] ${req.method} ${req.url}`);
    next();
  });
}

app.use(helmet());
app.use(cors());
app.use(express.json({ limit: "5mb" }));

// Endpoint de autenticación - ESTE ES EL IMPORTANTE
app.post("/api/v1/auth/token", requireClientSignature, (req, res) => {
  console.log("🔐 [AUTH] Endpoint /api/v1/auth/token llamado");
  const token = AuthService.sign({ sub: "ivan", scope: ["stickers"] });
  res.json({ token, expiresIn: env.JWT_EXPIRES_IN });
});

// Mock endpoints para desarrollo/testing
if (process.env.NODE_ENV === 'development' || process.env.ENABLE_MOCK === 'true') {
  console.log("🧪 Mock endpoints enabled for testing");
  
  app.get("/api/v1/mock/google/test-token", (req, res) => {
    console.log("🧪 [MOCK] Google test token endpoint llamado");
    res.json({ token: "mock-google-token", email: req.query.email });
  });
}

// Endpoints básicos (mock)
app.post("/api/v1/ai/process-image", auth, (req, res) => {
  console.log("🤖 [AI] Process image endpoint llamado");
  res.json({ stickerUrl: "https://animatedsticker.com/mock-sticker.png" });
});

app.get("/api/v1/packages", auth, (req, res) => {
  console.log("📦 [PACKAGES] Get packages endpoint llamado");
  res.json({ packages: [] });
});

console.log("🚀 aiStickers Backend v2.0.0 - ULTRA SIMPLIFIED");
console.log("🔐 POST /api/v1/auth/token (CON FIRMA HMAC)");
console.log("🧪 GET /api/v1/mock/google/test-token");

const PORT = env.PORT || 22024;
app.listen(PORT, () => {
  console.log("✅ SERVIDOR INICIADO EN PUERTO:", PORT);
});

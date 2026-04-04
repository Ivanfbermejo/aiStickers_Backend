// index.js (fragmento relevante)
import express from "express";
import helmet from "helmet";
import cors from "cors";
import path from "path";
import env from "./src/utils/env.js";
import { fileURLToPath } from "url";
import { AIController } from "./src/controllers/ai.controller.js";
import { AuthService } from "./src/services/auth.service.js";
import { auth } from "./src/middlewares/auth.middleware.js";
import { requireClientSignature } from "./src/middlewares/clientSign.middleware.js";
import { upload } from "./src/middlewares/local.middleware.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
app.use(helmet());
app.use(cors());

// Captura rawBody para firmar/verificar exactamente el body
app.use(express.json({
  limit: "5mb",
  verify: (req, _res, buf) => { req.rawBody = Buffer.from(buf); }
}));
app.use('/uploads', express.static(path.join(__dirname, './src/public/uploads')));

// Solo tu app (HMAC) puede pedir un JWT
app.post("/api/v1/auth/token", requireClientSignature, (req, res) => {
  const token = AuthService.sign({ sub: "ivan", scope: ["stickers"] });
  res.json({ token, expiresIn: env.JWT_EXPIRES_IN });
});

// Endpoints protegidos por JWT
app.post("/api/v1/ai/upload-url", upload.single("image"), auth, AIController.uploadLocalUrl);
app.post("/api/v1/ai/process-image", auth, AIController.processImage);
app.post("/api/v1/ai/img2vid", auth, AIController.img2vid); 

// Endpoints de stickers y paquetes
app.get("/api/v1/packages", auth, (req, res) => {
  // TODO: Implementar lógica de paquetes
  res.json({ packages: [], message: "Packages endpoint - coming soon" });
});

app.post("/api/v1/packages", auth, (req, res) => {
  // TODO: Implementar creación de paquetes
  res.json({ message: "Create package endpoint - coming soon" });
});

app.delete("/api/v1/packages/:id", auth, (req, res) => {
  // TODO: Implementar eliminación de paquetes
  res.json({ message: "Delete package endpoint - coming soon" });
});

// Mock endpoints para desarrollo/testing
app.get("/api/v1/mock/google/test-token", (req, res) => {
  res.json({ token: "mock-google-token", email: req.query.email });
});

app.get("/api/v1/mock/google/users", (req, res) => {
  res.json({ users: [] });
});

app.post("/api/v1/mock/google/users", (req, res) => {
  res.json({ message: "Mock Google user created" });
});

// Payments endpoints
app.post("/api/v1/payments/purchase", auth, (req, res) => {
  res.json({ message: "Purchase endpoint - coming soon" });
});

app.post("/api/v1/payments/validate/google-play", auth, (req, res) => {
  res.json({ valid: true, message: "Google Play validation - coming soon" });
});

app.post("/api/v1/payments/validate/apple-app-store", auth, (req, res) => {
  res.json({ valid: true, message: "Apple Store validation - coming soon" });
});

// i18n endpoints
app.get("/api/v1/i18n/:lang", (req, res) => {
  res.json({ lang: req.params.lang, translations: {} });
});

app.get("/api/v1/mock/i18n/:lang", (req, res) => {
  res.json({ lang: req.params.lang, translations: { welcome: "Welcome" } });
}); 

console.log("🚀 INICIANDO BACKEND - VERSIÓN 2.0.0 CON ENDPOINTS /api/v1/");
console.log("🔍 VERIFICANDO ENDPOINTS ACTUALES...");

const PORT = env.PORT || 3000;
console.log("🚀 aiStickers Backend v2.0.0 - API with /api/v1/ endpoints");
console.log("🔍 Endpoints disponibles:");
console.log("  🔐 POST /api/v1/auth/token");
console.log("  🔧 POST /api/v1/auth/token-debug (TEMPORAL)");
console.log("  🤖 POST /api/v1/ai/process-image");
console.log("  📦 GET /api/v1/packages");
console.log("  🧪 GET /api/v1/mock/google/test-token");
console.log("🌐 API on :" + PORT);
app.listen(PORT, () => {
  console.log("✅ SERVIDOR INICIADO CORRECTAMENTE EN PUERTO:", PORT);
});

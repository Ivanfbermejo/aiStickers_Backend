import express from 'express';
import cors from 'cors';
import helmet from 'helmet';

import env from "./src/utils/env.js";
import { AuthService } from "./src/services/auth.service.js";
import { auth } from "./src/middlewares/auth.middleware.js";
import { AuthController } from "./src/controllers/auth.controller.js";
import { PaymentCoreController } from "./src/controllers/paymentCore.controller.js";
import { BalanceController } from "./src/controllers/balance.controller.js";
import { PlanController } from "./src/controllers/plan.controller.js";
import { UserAssetsController } from "./src/controllers/userAssets.controller.js";
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

// Middleware para capturar rawBody SIN romper el stream para express.json
app.use((req, res, next) => {
  const chunks = []
  
  // Interceptar el evento 'data' sin consumir el stream
  const originalOn = req.on.bind(req)
  req.on = function(event, listener) {
    if (event === 'data') {
      const wrappedListener = function(chunk) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
        listener(chunk)
      }
      return originalOn(event, wrappedListener)
    }
    if (event === 'end') {
      const wrappedListener = function() {
        req.rawBody = Buffer.concat(chunks)
        listener()
      }
      return originalOn(event, wrappedListener)
    }
    return originalOn(event, listener)
  }
  
  next()
})

app.use(express.json({ limit: "5mb" }));

// Endpoint de autenticación - ESTE ES EL IMPORTANTE
app.post("/api/v1/auth/token", requireClientSignature, (req, res) => {
  console.log("🔐 [AUTH] Endpoint /api/v1/auth/token llamado");
  const token = AuthService.sign({ sub: "ivan", scope: ["stickers"] });
  res.json({ token, expiresIn: env.JWT_EXPIRES_IN });
});

// Autenticación social (públicos - sin auth middleware)
app.post("/api/v1/auth/google", AuthController.googleAuth);
app.post("/api/v1/auth/apple", AuthController.appleAuth);

// Gestión de sesión (requieren FIRMA DE APP + JWT de usuario)
app.post("/api/v1/auth/logout", requireClientSignature, auth, AuthController.logout);
app.post("/api/v1/auth/refresh", requireClientSignature, auth, AuthController.refreshToken);
app.get("/api/v1/auth/me", requireClientSignature, auth, AuthController.validateSession);

// Endpoints de validación de pagos (usan PaymentCoreController)
// Requieren FIRMA DE APP + JWT de usuario
app.post("/api/v1/payments/validate/google-play", requireClientSignature, auth, PaymentCoreController.validateGooglePlayPurchase);
app.post("/api/v1/payments/validate/apple-app-store", requireClientSignature, auth, PaymentCoreController.validateApplePurchase);

// Endpoint de planes de compra (usa PlanController)
// Requiere FIRMA DE APP + JWT de usuario
app.get("/api/v1/plans", requireClientSignature, auth, PlanController.getPlans);

// Endpoints de balance (usan BalanceController)
// Requieren FIRMA DE APP + JWT de usuario
app.get("/api/v1/users/balance", requireClientSignature, auth, BalanceController.getBalance);
app.post("/api/v1/users/balance/spend", requireClientSignature, auth, BalanceController.spendBalance);
app.get("/api/v1/users/balance/history", requireClientSignature, auth, BalanceController.getTransactionHistory);

// Endpoints de assets del usuario (stickers, paquetes)
// Requieren FIRMA DE APP + JWT de usuario
app.get("/api/v1/users/me/assets", requireClientSignature, auth, UserAssetsController.getMyAssets);
app.get("/api/v1/users/me/stickers", requireClientSignature, auth, UserAssetsController.getMyStickers);
app.post("/api/v1/users/me/stickers", requireClientSignature, auth, UserAssetsController.saveSticker);
app.delete("/api/v1/users/me/stickers/:stickerId", requireClientSignature, auth, UserAssetsController.deleteSticker);
app.get("/api/v1/users/me/packages", requireClientSignature, auth, UserAssetsController.getMyPackages);

console.log("🚀 aiStickers Backend v2.3.0 - SECURITY ENHANCED");
console.log("🔐 POST /api/v1/auth/token (HMAC signature)");
console.log("🔍 POST /api/v1/auth/google (Google Sign-In)");
console.log("👋 POST /api/v1/auth/logout (Logout)");
console.log("🔄 POST /api/v1/auth/refresh (Refresh Token)");
console.log("✅ GET /api/v1/auth/me (Validate Session)");
console.log("📋 GET /api/v1/plans (Purchase Plans)");
console.log("💰 GET /api/v1/users/balance (User Balance)");
console.log("🖼️  GET /api/v1/users/me/stickers (User Stickers)");
console.log("📦 GET /api/v1/users/me/packages (User Packages)");
console.log("� POST /api/v1/payments/validate/google-play (Google Play validation)");
console.log("🍎 POST /api/v1/payments/validate/apple-app-store (Apple validation)");

const PORT = env.PORT || 22024;
app.listen(PORT, () => {
  console.log("✅ SERVIDOR INICIADO EN PUERTO:", PORT);
});

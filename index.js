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

// Autenticación social (públicos - sin auth middleware)
app.post("/api/v1/auth/google", AuthController.googleAuth);
app.post("/api/v1/auth/apple", AuthController.appleAuth);

// Endpoints de validación de pagos (usan PaymentCoreController)
app.post("/api/v1/payments/validate/google-play", auth, PaymentCoreController.validateGooglePlayPurchase);
app.post("/api/v1/payments/validate/apple-app-store", auth, PaymentCoreController.validateApplePurchase);

// Endpoint de planes de compra (usa PlanController)
app.get("/api/v1/plans", auth, PlanController.getPlans);

// Endpoints de balance (usan BalanceController)
app.get("/api/v1/users/balance", auth, BalanceController.getBalance);
app.post("/api/v1/users/balance/spend", auth, BalanceController.spendBalance);
app.get("/api/v1/users/balance/history", auth, BalanceController.getTransactionHistory);

console.log("🚀 aiStickers Backend v2.1.0 - CLEAN ARCHITECTURE");
console.log("🔐 POST /api/v1/auth/token (HMAC signature)");
console.log("🔍 POST /api/v1/auth/google (Google Sign-In)");
console.log("📋 GET /api/v1/plans (Purchase Plans)");
console.log("💰 GET /api/v1/users/balance (User Balance)");
console.log("📦 POST /api/v1/payments/validate/google-play (Google Play validation)");
console.log("🍎 POST /api/v1/payments/validate/apple-app-store (Apple validation)");

const PORT = env.PORT || 22024;
app.listen(PORT, () => {
  console.log("✅ SERVIDOR INICIADO EN PUERTO:", PORT);
});

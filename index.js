import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';

import env from "./src/utils/env.js";
import { AuthService } from "./src/services/auth.service.js";
import { auth } from "./src/middlewares/auth.middleware.js";
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

// Endpoints de autenticación social (públicos)
app.post("/api/v1/auth/google", (req, res) => {
  console.log("🔍 [GOOGLE_AUTH] Google authentication endpoint llamado");
  
  const { idToken } = req.body;
  if (!idToken) {
    return res.status(400).json({
      success: false,
      error: "Google ID token is required"
    });
  }
  
  // Mock authentication para desarrollo
  const mockUser = {
    sub: "google_user_" + Math.random().toString(36).substr(2, 9),
    email: "user@gmail.com",
    name: "Google User",
    picture: "https://via.placeholder.com/150"
  };
  
  console.log("🔍 [GOOGLE_AUTH] Usuario autenticado:", mockUser.email);
  
  // Generar JWT token para el usuario
  const userToken = jwt.sign(
    { 
      sub: mockUser.sub,
      email: mockUser.email,
      name: mockUser.name,
      provider: 'google'
    },
    process.env.JWT_SECRET || 'your-secret-key',
    { expiresIn: '24h' }
  );
  
  res.json({
    success: true,
    user: mockUser,
    token: userToken,
    message: "Google authentication successful"
  });
});

app.post("/api/v1/auth/apple", (req, res) => {
  console.log("🍎 [APPLE_AUTH] Apple authentication endpoint llamado");
  
  const { identityToken, userInfo } = req.body;
  if (!identityToken) {
    return res.status(400).json({
      success: false,
      error: "Apple identity token is required"
    });
  }
  
  // Mock authentication para desarrollo
  const mockUser = {
    sub: "apple_user_" + Math.random().toString(36).substr(2, 9),
    email: userInfo?.email || "user@icloud.com",
    name: userInfo?.name || "Apple User"
  };
  
  console.log("🍎 [APPLE_AUTH] Usuario autenticado:", mockUser.email);
  
  // Generar JWT token para el usuario
  const userToken = jwt.sign(
    { 
      sub: mockUser.sub,
      email: mockUser.email,
      name: mockUser.name,
      provider: 'apple'
    },
    process.env.JWT_SECRET || 'your-secret-key',
    { expiresIn: '24h' }
  );
  
  res.json({
    success: true,
    user: mockUser,
    token: userToken,
    message: "Apple authentication successful"
  });
});

// Endpoint de balance de usuario (seguro - userID desde JWT)
app.get("/api/v1/users/balance", auth, (req, res) => {
  // Obtener userId desde el token JWT decodificado
  const userId = req.user?.sub || "ivan"; // req.user viene del middleware auth
  console.log("💰 [BALANCE] Get balance endpoint llamado para userId:", userId);
  
  // Balance random para testing
  const randomBalance = Math.floor(Math.random() * 100); // Entre 0 y 99
  
  console.log("💰 [BALANCE] Enviando balance random:", randomBalance, "para userId:", userId);
  
  res.json({ 
    success: true,
    userId: userId,
    balance: randomBalance,
    currency: "USD",
    lastUpdated: new Date().toISOString()
  });
});

// Endpoint de compra (mock)
app.post("/api/v1/payments/purchase", auth, (req, res) => {
  console.log("💳 [PURCHASE] Purchase endpoint llamado");
  
  // Obtener datos del request
  const { amount, price } = req.body || {};
  console.log("💳 [PURCHASE] Purchase request:", amount, "🪙 for", price);
  
  // Simular proceso de compra y actualizar balance
  // En un caso real, esto involucraría pasarelas de pago, etc.
  const userId = req.user?.sub || "ivan";
  
  // Generar nuevo balance (simulando que se añade el amount)
  const newBalance = Math.floor(Math.random() * 100) + parseInt(amount || 0);
  
  console.log("💳 [PURCHASE] Purchase successful! New balance:", newBalance, "🪙 para userId:", userId);
  
  res.json({ 
    success: true,
    userId: userId,
    amount: amount || 0,
    price: price || "0.00",
    newBalance: newBalance,
    currency: "USD",
    transactionId: "txn_" + Date.now(),
    timestamp: new Date().toISOString()
  });
});

// Endpoints de validación de pagos (usan PaymentCoreController)
app.post("/api/v1/payments/validate/google-play", auth, PaymentCoreController.validateGooglePlayPurchase);
app.post("/api/v1/payments/validate/apple-app-store", auth, PaymentCoreController.validateApplePurchase);

// Endpoint de planes de compra (usa PlanController)
app.get("/api/v1/plans", auth, PlanController.getPlans);

// Endpoints de balance (usan BalanceController)
app.get("/api/v1/users/balance", auth, BalanceController.getBalance);
app.post("/api/v1/users/balance/spend", auth, BalanceController.spendBalance);
app.get("/api/v1/users/balance/history", auth, BalanceController.getTransactionHistory);

console.log("🚀 aiStickers Backend v2.0.0 - ULTRA SIMPLIFIED");
console.log("🔐 POST /api/v1/auth/token (CON FIRMA HMAC)");
console.log("🧪 GET /api/v1/mock/google/test-token");
console.log("📋 GET /api/v1/plans (Purchase Plans)");
console.log("📦 POST /api/v1/payments/validate/google-play (Google Play validation)");
console.log("🍎 POST /api/v1/payments/validate/apple-app-store (Apple App Store validation)");

const PORT = env.PORT || 22024;
app.listen(PORT, () => {
  console.log("✅ SERVIDOR INICIADO EN PUERTO:", PORT);
});

#!/usr/bin/env node
/**
 * aiStickers Backend
 * Clean Architecture Implementation
 */

import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import bodyParser from 'body-parser';
import crypto from 'crypto';

// Configuration
import { env, validateEnv } from './src/config/env.js';
import { container } from './src/config/container.js';

// Middleware
import { requireHmac } from './src/infrastructure/web/middleware/hmac.middleware.js';
import { requireAuth, requireUser } from './src/infrastructure/web/middleware/auth.middleware.js';

// Controllers
import { AuthController } from './src/infrastructure/web/controllers/auth.controller.js';
import { PaymentController } from './src/infrastructure/web/controllers/payment.controller.js';
import { BalanceController } from './src/infrastructure/web/controllers/balance.controller.js';
import { ConfigController } from './src/infrastructure/web/controllers/config.controller.js';
import { PlanController } from './src/infrastructure/web/controllers/plan.controller.js';
import { I18nController } from './src/infrastructure/web/controllers/i18n.controller.js';

// Initialize
const app = express();

// Validate environment
validateEnv();

// CORS - Allow all origins and required headers
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Client-Id', 'X-Timestamp', 'X-User-JWT', 'X-App-Id', 'X-App-Timestamp', 'X-App-Nonce', 'X-App-Signature']
}));

// Security headers
app.use(helmet());

// JSON parsing with raw body capture for HMAC (matches clientSign.middleware.js)
app.use(bodyParser.json({
  limit: '5mb',
  verify: (req, res, buf) => {
    req.rawBody = buf; // Keep as Buffer for correct hash calculation
  }
}));

// Initialize dependency container
container.initialize().then(() => {
  console.log('🚀 aiStickers Backend - Clean Architecture');
  console.log(`📦 Environment: ${env.NODE_ENV}`);
  console.log(`💾 Data Directory: ${env.DATA_DIR}`);
  
  // ========== ROUTES ==========
  
  // Health Check
  app.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });
  
  // --- Authentication ---
  // App Token (HMAC only)
  app.post('/api/v1/auth/token', requireHmac, AuthController.generateAppToken);
  
  // Google Sign-In (HMAC + User auth)
  app.post('/api/v1/auth/google', requireHmac, AuthController.googleAuth);
  
  // Session Management (HMAC + User JWT)
  app.get('/api/v1/auth/me', requireHmac, requireAuth, AuthController.validateSession);
  app.post('/api/v1/auth/refresh', requireHmac, AuthController.refreshToken);
  app.post('/api/v1/auth/logout', requireHmac, requireAuth, AuthController.logout);
  
  // --- Configuration (HMAC only) ---
  app.get('/api/v1/config', requireHmac, ConfigController.getConfig);

  // --- Translations (HMAC only) ---
  app.get('/api/v1/i18n/:lang', requireHmac, I18nController.getTranslations);
  
  // --- Plans (HMAC + User JWT) ---
  app.get('/api/v1/plans', requireHmac, requireAuth, PlanController.getPlans);
  
  // --- Payments (HMAC + User JWT required) ---
  app.post('/api/v1/payments/validate/google-play', requireHmac, requireUser, PaymentController.validateGooglePlayPurchase);
  app.post('/api/v1/payments/validate/apple-app-store', requireHmac, requireUser, PaymentController.validateApplePurchase);
  
  // --- Balance (HMAC + User JWT required) ---
  app.get('/api/v1/users/balance', requireHmac, requireUser, BalanceController.getBalance);
  app.post('/api/v1/users/balance/spend', requireHmac, requireUser, BalanceController.spendBalance);
  app.get('/api/v1/users/balance/history', requireHmac, requireUser, BalanceController.getTransactionHistory);
  
  // --- Error Handling ---
  app.use((err, req, res, next) => {
    console.error('Unhandled error:', err);
    res.status(500).json({
      error: 'Internal server error',
      message: env.NODE_ENV === 'development' ? err.message : undefined
    });
  });
  
  // 404 Handler
  app.use((req, res) => {
    res.status(404).json({ error: 'Not found' });
  });
  
  // Start server
  const PORT = env.PORT;
  const HOST = '0.0.0.0'; // Listen on all interfaces
  app.listen(PORT, HOST, () => {
    console.log(`✅ Server running on http://${HOST}:${PORT}`);
    console.log('\n📋 Available Endpoints:');
    console.log('  POST /api/v1/auth/token           (HMAC)        - App authentication');
    console.log('  POST /api/v1/auth/google          (HMAC)        - Google Sign-In');
    console.log('  GET  /api/v1/auth/me              (HMAC+User)   - Validate session');
    console.log('  POST /api/v1/auth/refresh         (HMAC)        - Refresh JWT token');
    console.log('  POST /api/v1/auth/logout          (HMAC+User)   - Logout');
    console.log('  GET  /api/v1/config               (HMAC)        - Public config');
    console.log('  GET  /api/v1/i18n/:lang           (HMAC)        - Translations');
    console.log('  GET  /api/v1/plans                (HMAC+User)   - Purchase plans');
    console.log('  POST /api/v1/payments/validate/*  (HMAC+User)   - Validate purchases');
    console.log('  GET  /api/v1/users/balance        (HMAC+User)   - User balance');
    console.log('  GET  /api/v1/users/balance/history (HMAC+User)  - Transaction history');
    console.log('\n🔒 Security: All endpoints require HMAC + User JWT for sensitive operations\n');
  });
});

export default app;

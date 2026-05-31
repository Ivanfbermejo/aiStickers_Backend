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
import multer from 'multer';
import path from 'path';
import fs from 'fs';

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
import { AiController } from './src/infrastructure/web/controllers/ai.controller.js';
import { StickerController } from './src/infrastructure/web/controllers/sticker.controller.js';
import { PackageController } from './src/infrastructure/web/controllers/package.controller.js';

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

// Configure multer for file uploads
const uploadsDir = path.join(env.DATA_DIR, 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// Use memoryStorage — image buffer sent directly to Replicate as base64 data URI
const upload = multer({ 
  storage: multer.memoryStorage(),
  limits: { 
    fileSize: 10 * 1024 * 1024, // 10MB file limit
    fieldSize: 15 * 1024 * 1024, // 15MB field limit (for base64)
    fields: 10,
    files: 1
  },
  fileFilter: (req, file, cb) => {
    console.log('[Multer] 🔍 File received:', {
      fieldname: file.fieldname,
      originalname: file.originalname,
      mimetype: file.mimetype
    });
    // Accept only images
    if (file.mimetype.startsWith('image/')) {
      console.log('[Multer] ✅ Image accepted');
      cb(null, true);
    } else {
      console.log('[Multer] ❌ Rejected - not an image');
      cb(new Error('Only image files are allowed'));
    }
  }
});

// Serve uploaded files statically
app.use('/uploads', express.static(uploadsDir));
console.log('📁 Serving uploads from:', uploadsDir);

// JSON parsing with raw body capture for HMAC (matches clientSign.middleware.js)
// NOTE: This only applies to JSON requests, multipart is handled separately
app.use((req, res, next) => {
  const contentType = req.headers['content-type'] || '';
  console.log(`[BodyParser] ${req.method} ${req.path} Content-Type: ${contentType}`);
  
  // Skip body parsing for multipart requests - let multer handle them
  if (contentType.includes('multipart/form-data')) {
    console.log('[BodyParser] ⏭️ Skipping JSON parser for multipart');
    return next();
  }
  // For JSON and other requests, use standard body parser
  console.log('[BodyParser] 📄 Using JSON parser');
  bodyParser.json({
    limit: '5mb',
    verify: (req, res, buf) => {
      req.rawBody = buf;
    }
  })(req, res, next);
});

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
  app.get('/api/v1/users/me/assets', requireHmac, requireUser, BalanceController.getUserAssets);
  
  // --- AI Sticker Generation (HMAC + User JWT required) ---
  // Debug middleware to track request flow
  const logRequestFlow = (req, res, next) => {
    console.log('[RequestFlow] 📥 Reached multer middleware');
    console.log('[RequestFlow] Content-Type:', req.headers['content-type']);
    console.log('[RequestFlow] Content-Length:', req.headers['content-length']);
    next();
  };
  
  // Multer error handler wrapper
  const handleMulterError = (err, req, res, next) => {
    if (err instanceof multer.MulterError) {
      console.error('[Multer Error]', err.code, err.message);
      return res.status(400).json({ error: 'File upload error', message: err.message });
    }
    if (err) {
      console.error('[Upload Error]', err.message);
      return res.status(400).json({ error: 'Upload error', message: err.message });
    }
    console.log('[RequestFlow] ✅ Multer completed, req.file:', req.file ? 'present' : 'undefined');
    next();
  };
  
  app.post('/api/v1/ai/process-image', requireHmac, requireUser, logRequestFlow, upload.single('image'), handleMulterError, AiController.processImage);
  app.post('/api/v1/ai/img2vid', requireHmac, requireUser, AiController.img2vid);
  app.get('/api/v1/ai/status/:predictionId', requireHmac, requireUser, AiController.getStatus);
  
  // --- Stickers CRUD (HMAC + User JWT required) ---
  app.get('/api/v1/stickers', requireHmac, requireUser, StickerController.getUserStickers);
  app.get('/api/v1/stickers/package/:packageId', requireHmac, requireUser, StickerController.getStickersByPackage);
  app.get('/api/v1/stickers/:id', requireHmac, requireUser, StickerController.getStickerById);
  app.post('/api/v1/stickers', requireHmac, requireUser, StickerController.createSticker);
  app.put('/api/v1/stickers/:id', requireHmac, requireUser, StickerController.updateSticker);
  app.delete('/api/v1/stickers/:id', requireHmac, requireUser, StickerController.deleteSticker);
  
  // --- Packages CRUD (HMAC + User JWT required) ---
  app.get('/api/v1/packages', requireHmac, requireUser, PackageController.getUserPackages);
  app.get('/api/v1/packages/public', requireHmac, PackageController.getPublicPackages);
  app.get('/api/v1/packages/:id', requireHmac, requireUser, PackageController.getPackageById);
  app.post('/api/v1/packages', requireHmac, requireUser, PackageController.createPackage);
  app.put('/api/v1/packages/:id', requireHmac, requireUser, PackageController.updatePackage);
  app.delete('/api/v1/packages/:id', requireHmac, requireUser, PackageController.deletePackage);
  
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
    console.log('  GET  /api/v1/users/me/assets     (HMAC+User)   - User assets (balance+stickers+packages)');
    console.log('  GET  /api/v1/users/balance/history (HMAC+User)  - Transaction history');
    console.log('  POST /api/v1/ai/process-image     (HMAC+User)   - Generate sticker from image');
    console.log('  POST /api/v1/ai/img2vid           (HMAC+User)   - Generate video from image');
    console.log('  GET  /api/v1/ai/status/:id        (HMAC+User)   - Check generation status');
    console.log('  GET  /api/v1/stickers             (HMAC+User)   - List user stickers');
    console.log('  GET  /api/v1/stickers/:id         (HMAC+User)   - Get sticker by ID');
    console.log('  POST /api/v1/stickers             (HMAC+User)   - Create sticker manually');
    console.log('  PUT  /api/v1/stickers/:id         (HMAC+User)   - Update sticker');
    console.log('  DEL  /api/v1/stickers/:id         (HMAC+User)   - Delete sticker');
    console.log('  GET  /api/v1/packages             (HMAC+User)   - List user packages');
    console.log('  GET  /api/v1/packages/public      (HMAC)        - List public packages');
    console.log('  GET  /api/v1/packages/:id         (HMAC+User)   - Get package by ID');
    console.log('  POST /api/v1/packages             (HMAC+User)   - Create package');
    console.log('  PUT  /api/v1/packages/:id         (HMAC+User)   - Update package');
    console.log('  DEL  /api/v1/packages/:id         (HMAC+User)   - Delete package');
    console.log('\n🔒 Security: All endpoints require HMAC + User JWT for sensitive operations\n');
  });
});

export default app;

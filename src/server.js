import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import crypto from 'crypto';
import multer from 'multer';
import path from 'path';
import fs from 'fs';

// Configuration
import { env, validateEnv } from './config/env.js';
import { container } from './config/container.js';
import { pingDatabase, disconnectPrisma } from './infrastructure/persistence/prisma/client.js';

// Middleware
import { requireHmac } from './infrastructure/web/middleware/hmac.middleware.js';
import { requireAuth, requireUser, optionalUser } from './infrastructure/web/middleware/auth.middleware.js';
import { redisSecurityService } from './infrastructure/security/redis-security.service.js';
import { limitActiveGenerations, rateLimitIp, rateLimitUser } from './infrastructure/web/middleware/rate-limit.middleware.js';

// Controllers
import { AuthController } from './infrastructure/web/controllers/auth.controller.js';
import { PaymentController } from './infrastructure/web/controllers/payment.controller.js';
import { BalanceController } from './infrastructure/web/controllers/balance.controller.js';
import { ConfigController } from './infrastructure/web/controllers/config.controller.js';
import { PlanController } from './infrastructure/web/controllers/plan.controller.js';
import { I18nController } from './infrastructure/web/controllers/i18n.controller.js';
import { AiController } from './infrastructure/web/controllers/ai.controller.js';
import { GenerationController } from './infrastructure/web/controllers/generation.controller.js';
import { StickerController } from './infrastructure/web/controllers/sticker.controller.js';
import { PackageController } from './infrastructure/web/controllers/package.controller.js';
import { StyleController } from './infrastructure/web/controllers/style.controller.js';
import { TelegramController } from './infrastructure/web/controllers/telegram.controller.js';
import { WhatsAppStickerExportController } from './infrastructure/web/controllers/whatsapp-sticker-export.controller.js';
import { AssetController } from './infrastructure/web/controllers/asset.controller.js';

/**
 * Configure the Express application without starting the HTTP server or the
 * background worker. Returns the app and the initialized container so tests
 * can mount Supertest and inspect dependencies.
 */
export async function createApp() {
  validateEnv(env);

  const app = express();
  // Never trust every proxy. Operators may provide an explicit hop count or
  // comma-separated network allowlist through TRUST_PROXY.
  app.set('trust proxy', env.TRUST_PROXY);
  app.locals.container = container;
  app.locals.redisSecurity = redisSecurityService;

  // CORS - wildcard only in development; explicit origins in production
  const corsOrigins = env.CORS_ORIGINS;
  const corsOptions = {
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Client-Id', 'X-Timestamp', 'X-User-JWT', 'X-App-Id', 'X-App-Timestamp', 'X-App-Nonce', 'X-App-Signature', 'X-App-Hmac-Version', 'X-Integrity-Provider', 'X-Integrity-Token']
  };

  if (corsOrigins === '*') {
    corsOptions.origin = '*';
  } else {
    corsOptions.origin = function (origin, callback) {
      if (!origin || corsOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error('Not allowed by CORS'));
      }
    };
  }

  app.use(cors(corsOptions));

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
      console.log('[Multer] File received:', {
        fieldname: file.fieldname,
        originalname: file.originalname,
        mimetype: file.mimetype
      });
      // Accept only images
      if (file.mimetype.startsWith('image/')) {
        console.log('[Multer] Image accepted');
        cb(null, true);
      } else {
        console.log('[Multer] Rejected - not an image');
        cb(new Error('Only image files are allowed'));
      }
    }
  });

  // Serve uploaded files statically only in development/test. Production must
  // use private object storage and signed URLs.
  if (env.NODE_ENV !== 'production') {
    app.use('/uploads', express.static(uploadsDir));
  }

  // JSON parsing with raw body capture for HMAC (matches clientSign.middleware.js)
  // NOTE: This only applies to JSON requests, multipart is handled separately
  app.use((req, res, next) => {
    const contentType = req.headers['content-type'] || '';
    console.log(`[BodyParser] ${req.method} ${req.path} Content-Type: ${contentType}`);

    // Skip body parsing for multipart requests - let multer handle them
    if (contentType.includes('multipart/form-data')) {
      console.log('[BodyParser] Skipping JSON parser for multipart');
      return next();
    }
    // For JSON and other requests, use standard body parser
    console.log('[BodyParser] Using JSON parser');
    express.json({
      limit: '5mb',
      verify: (req, res, buf) => {
        req.rawBody = buf;
      }
    })(req, res, next);
  });

  // Initialize dependency container
  await container.initialize();
  console.log('aiStickers Backend - Clean Architecture');
  console.log(`Environment: ${env.NODE_ENV}`);
  console.log(`Data Directory: ${env.DATA_DIR}`);

  // ========== ROUTES ==========

  // Health Checks
  app.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  app.get('/health/live', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  app.get('/health/ready', async (req, res) => {
    try {
      const probeFile = path.join(env.DATA_DIR, 'uploads', '.ready-probe');
      await fs.promises.writeFile(probeFile, new Date().toISOString());
      await fs.promises.rm(probeFile, { force: true });

      // Only probe Postgres when it is actually configured. JSON remains the
      // default persistence in development until T05B cuts repositories over.
      if (env.DATABASE_URL) {
        await pingDatabase();
      }

      await app.locals.redisSecurity.checkReady();

      res.json({ status: 'ready', timestamp: new Date().toISOString() });
    } catch (error) {
      console.error('Readiness probe failed:', error);
      res.status(503).json({ status: 'not ready', error: error.message });
    }
  });

  // --- Authentication ---
  // App Token (HMAC only)
  app.post('/api/v1/auth/token', rateLimitIp({
    scope: 'auth-token-ip',
    limit: env.RATE_LIMIT_AUTH_TOKEN_PER_MINUTE
  }), requireHmac, AuthController.generateAppToken);

  // Google Sign-In (HMAC + User auth)
  app.post('/api/v1/auth/google', rateLimitIp({
    scope: 'auth-google-ip',
    limit: env.RATE_LIMIT_AUTH_GOOGLE_PER_MINUTE
  }), requireHmac, AuthController.googleAuth);

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
  app.post('/api/v1/payments/validate/google-play', requireHmac, requireUser, rateLimitUser({
    scope: 'payment-user',
    limit: env.RATE_LIMIT_PAYMENT_PER_MINUTE,
    failClosed: true
  }), PaymentController.validateGooglePlayPurchase);
  if (env.ENABLE_APPLE_PAYMENTS) {
    app.post('/api/v1/payments/validate/apple-app-store', requireHmac, requireUser, rateLimitUser({
      scope: 'payment-user',
      limit: env.RATE_LIMIT_PAYMENT_PER_MINUTE,
      failClosed: true
    }), PaymentController.validateApplePurchase);
  }

  // --- Balance (HMAC + User JWT required) ---
  app.get('/api/v1/users/balance', requireHmac, requireUser, BalanceController.getBalance);
  // T06: client-initiated spend removed. Spending only happens as a server-side
  // authorized side effect of creating a generation job.
  app.get('/api/v1/users/balance/history', requireHmac, requireUser, BalanceController.getTransactionHistory);
  app.get('/api/v1/users/me/assets', requireHmac, requireUser, BalanceController.getUserAssets);

  // --- AI Sticker Generation (HMAC + User JWT required) ---
  // Debug middleware to track request flow
  const logRequestFlow = (req, res, next) => {
    console.log('[RequestFlow] Reached multer middleware');
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
    console.log('[RequestFlow] Multer completed, req.file:', req.file ? 'present' : 'undefined');
    next();
  };

  const rejectLegacyMultipartInProduction = (req, res, next) => {
    if (env.NODE_ENV === 'production' && req.headers['content-type']?.toLowerCase().includes('multipart/form-data')) {
      return res.status(415).json({
        error: 'Legacy multipart disabled',
        message: 'Use a JSON request with objectKey and hash'
      });
    }
    return next();
  };

  const generationRateLimit = rateLimitUser({
    scope: 'generation-user',
    limit: env.RATE_LIMIT_GENERATION_PER_MINUTE,
    failClosed: true
  });
  const activeGenerationLimit = limitActiveGenerations();
  const uploadRateLimit = rateLimitUser({
    scope: 'upload-user',
    limit: env.RATE_LIMIT_UPLOAD_PER_MINUTE,
    failClosed: true
  });
  const statusRateLimit = rateLimitUser({
    scope: 'status-user',
    limit: env.RATE_LIMIT_STATUS_PER_MINUTE,
    failClosed: true
  });
  const exportRateLimit = rateLimitUser({
    scope: 'export-user',
    limit: env.RATE_LIMIT_EXPORT_PER_MINUTE,
    failClosed: true
  });

  app.post('/api/v1/ai/process-image', rejectLegacyMultipartInProduction, requireHmac, requireUser, generationRateLimit, uploadRateLimit, activeGenerationLimit, logRequestFlow, upload.single('image'), handleMulterError, AiController.processImage);
  app.post('/api/v1/ai/img2vid', requireHmac, requireUser, generationRateLimit, activeGenerationLimit, AiController.img2vid);
  app.get('/api/v1/ai/status/:predictionId', requireHmac, requireUser, statusRateLimit, AiController.getStatus);

  // --- Async Generation (HMAC + User JWT required) ---
  app.post('/api/v1/generation', requireHmac, requireUser, generationRateLimit, activeGenerationLimit, GenerationController.create);
  app.get('/api/v1/generation', requireHmac, requireUser, statusRateLimit, GenerationController.getUserJobs);
  app.get('/api/v1/generation/:jobId', requireHmac, requireUser, statusRateLimit, GenerationController.getById);

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

  // --- Styles (HMAC only - public endpoint) ---
  app.get('/api/v1/styles', requireHmac, StyleController.getStyles);

  // --- Telegram Sticker Packs (HMAC + User JWT required) ---
  if (env.ENABLE_TELEGRAM) {
    app.post('/api/v1/telegram/export-pack', requireHmac, requireUser, exportRateLimit, TelegramController.exportPack);
    app.post('/api/v1/telegram/reconcile-pack', requireHmac, requireUser, TelegramController.reconcilePack);
    app.get('/api/v1/telegram/pack-status/:setName', requireHmac, requireUser, statusRateLimit, TelegramController.getPackStatus);
  }

  // --- WhatsApp Sticker Export (HMAC + User JWT required) ---
  if (env.ENABLE_WHATSAPP_EXPORT) {
    app.post('/api/v1/stickers/:id/export/whatsapp', requireHmac, requireUser, exportRateLimit, WhatsAppStickerExportController.exportSticker);
    app.get('/api/v1/stickers/:id/export/whatsapp', requireHmac, requireUser, statusRateLimit, WhatsAppStickerExportController.getStickerExportStatus);
    app.post('/api/v1/packages/:id/export/whatsapp', requireHmac, requireUser, exportRateLimit, WhatsAppStickerExportController.exportPackage);
    app.get('/api/v1/packages/:id/export/whatsapp', requireHmac, requireUser, statusRateLimit, WhatsAppStickerExportController.getPackageExportStatus);
  }

  // --- Private Assets (User JWT or signed token) ---
  app.get('/api/v1/assets/*', optionalUser, AssetController.getAsset);

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

  return { app, container };
}

/**
 * Bootstrap the HTTP process. Generation consumers run separately through
 * `npm run worker:generation`; this process is producer-only.
 */
export async function startServer(options = {}) {
  const { app, container } = await createApp();

  const PORT = options.port ?? env.PORT;
  const HOST = options.host ?? '0.0.0.0';

  const server = app.listen(PORT, HOST, () => {
    console.log(`Server running on http://${HOST}:${PORT}`);
    console.log('\nAvailable Endpoints:');
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
    console.log('\nSecurity: All endpoints require HMAC + User JWT for sensitive operations\n');
  });

  return { app, server, container };
}

/**
 * Gracefully stop the HTTP producer process.
 */
export async function stopServer({ server, container }) {
  await new Promise((resolve) => server.close(() => resolve()));
  await container.services.generationQueue?.close();
  await redisSecurityService.close();
  await disconnectPrisma();
}

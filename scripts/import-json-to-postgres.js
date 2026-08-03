import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { getPrismaClient, disconnectPrisma } from '../src/infrastructure/persistence/prisma/client.js';

const REQUIRED_FILES = [
  'users.json',
  'balances.json',
  'transactions.json',
  'purchases.json',
  'stickers.json',
  'packages.json',
  'generation-jobs.json',
  'sessions.json'
];

const VALID_PROVIDERS = new Set(['GOOGLE_PLAY', 'APPLE_APP_STORE']);
const VALID_TRANSACTION_TYPES = new Set(['PURCHASE', 'SPEND', 'REFUND']);
const VALID_PURCHASE_STATUSES = new Set(['PENDING', 'VERIFIED', 'FAILED']);
const VALID_STICKER_STATUSES = new Set(['pending', 'processing', 'done', 'error']);
const VALID_PACKAGE_PACK_TYPES = new Set(['static', 'animated']);
const VALID_PACKAGE_EXPORT_STATUS = new Set(['pending', 'processing', 'ready', 'failed']);
const VALID_JOB_TYPES = new Set(['image_sticker', 'animated_sticker', 'img2vid']);
const VALID_JOB_STATUSES = new Set(['queued', 'processing', 'completed', 'failed', 'cancelled']);

function parseArgs(argv) {
  const args = argv.slice(2);
  const result = { source: null, commit: false };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--source') {
      result.source = args[++i];
    } else if (arg === '--commit') {
      result.commit = true;
    } else if (arg === '--help' || arg === '-h') {
      printUsage();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  if (!result.source) {
    throw new Error('Missing required --source argument');
  }
  return result;
}

function printUsage() {
  console.log('Usage: node scripts/import-json-to-postgres.js --source <json-dir> [--commit]');
  console.log('');
  console.log('Options:');
  console.log('  --source <dir>  Directory containing the JSON export files.');
  console.log('  --commit        Actually write to PostgreSQL. Without this flag the import is a dry run.');
}

function hashToken(token) {
  return createHash('sha256').update(token).digest('hex');
}

function loadJsonFile(filePath) {
  const raw = readFileSync(filePath, 'utf8');
  try {
    return JSON.parse(raw);
  } catch (err) {
    throw new Error(`Corrupt JSON in ${filePath}: ${err.message}`);
  }
}

function asObject(data, fileName) {
  if (data === null || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error(`Corrupt JSON in ${fileName}: expected an object keyed by id`);
  }
  return data;
}

function normalizeRecords(data, fileName) {
  const obj = asObject(data, fileName);
  const records = [];
  for (const [id, record] of Object.entries(obj)) {
    if (!record || typeof record !== 'object' || Array.isArray(record)) {
      throw new Error(`Corrupt record in ${fileName} at key ${id}: expected an object`);
    }
    records.push({ ...record, id });
  }
  return records;
}

function validateUser(record) {
  if (!record.email || !record.email.includes('@')) {
    throw new Error(`Invalid user ${record.id}: missing or invalid email`);
  }
}

function validateTransaction(record) {
  if (!VALID_TRANSACTION_TYPES.has(record.type)) {
    throw new Error(`Invalid transaction ${record.id}: type must be PURCHASE, SPEND or REFUND`);
  }
  if (typeof record.amount !== 'number' || record.amount <= 0) {
    throw new Error(`Invalid transaction ${record.id}: amount must be a positive number`);
  }
}

function validatePurchase(record) {
  if (!VALID_PROVIDERS.has(record.provider)) {
    throw new Error(`Invalid purchase ${record.id}: provider must be GOOGLE_PLAY or APPLE_APP_STORE`);
  }
  if (!record.purchaseToken || typeof record.purchaseToken !== 'string') {
    throw new Error(`Invalid purchase ${record.id}: missing purchaseToken`);
  }
  if (typeof record.stickerAmount !== 'number' || record.stickerAmount <= 0) {
    throw new Error(`Invalid purchase ${record.id}: stickerAmount must be positive`);
  }
  if (record.status && !VALID_PURCHASE_STATUSES.has(record.status)) {
    throw new Error(`Invalid purchase ${record.id}: status must be PENDING, VERIFIED or FAILED`);
  }
}

function validateSticker(record) {
  if (!record.userId) {
    throw new Error(`Invalid sticker ${record.id}: missing userId`);
  }
  if (record.status && !VALID_STICKER_STATUSES.has(record.status)) {
    throw new Error(`Invalid sticker ${record.id}: status must be pending, processing, done or error`);
  }
}

function validatePackage(record) {
  if (!record.userId) {
    throw new Error(`Invalid package ${record.id}: missing userId`);
  }
  if (!record.name || typeof record.name !== 'string') {
    throw new Error(`Invalid package ${record.id}: missing name`);
  }
  if (record.packType && !VALID_PACKAGE_PACK_TYPES.has(record.packType)) {
    throw new Error(`Invalid package ${record.id}: packType must be static or animated`);
  }
  if (record.exportStatus && !VALID_PACKAGE_EXPORT_STATUS.has(record.exportStatus)) {
    throw new Error(`Invalid package ${record.id}: exportStatus must be pending, processing, ready or failed`);
  }
}

function validateJob(record) {
  if (!record.userId) {
    throw new Error(`Invalid generation job ${record.id}: missing userId`);
  }
  if (!record.stickerId) {
    throw new Error(`Invalid generation job ${record.id}: missing stickerId`);
  }
  if (!record.type || !VALID_JOB_TYPES.has(record.type)) {
    throw new Error(`Invalid generation job ${record.id}: type must be image_sticker, animated_sticker or img2vid`);
  }
  if (record.status && !VALID_JOB_STATUSES.has(record.status)) {
    throw new Error(`Invalid generation job ${record.id}: status must be queued, processing, completed, failed or cancelled`);
  }
}

function validateSession(record) {
  if (!record.userId) {
    throw new Error(`Invalid session ${record.id}: missing userId`);
  }
  if (!record.refreshTokenHash || typeof record.refreshTokenHash !== 'string') {
    throw new Error(`Invalid session ${record.id}: missing refreshTokenHash`);
  }
  if (!record.family || typeof record.family !== 'string') {
    throw new Error(`Invalid session ${record.id}: missing family`);
  }
  if (!record.expiresAt) {
    throw new Error(`Invalid session ${record.id}: missing expiresAt`);
  }
}

async function loadSource(sourceDir) {
  const files = await readdir(sourceDir);
  const missing = REQUIRED_FILES.filter(f => !files.includes(f));
  if (missing.length > 0) {
    throw new Error(`Source directory is missing required files: ${missing.join(', ')}`);
  }

  const data = {};
  for (const file of REQUIRED_FILES) {
    const key = file.replace(/\.json$/, '');
    data[key] = normalizeRecords(loadJsonFile(path.join(sourceDir, file)), file);
  }
  return data;
}

function validateReferences(data) {
  const userIds = new Set(data.users.map(r => r.id));
  const packageIds = new Set(data.packages.map(r => r.id));
  const stickerIds = new Set(data.stickers.map(r => r.id));

  function requireUser(record, label) {
    if (!userIds.has(record.userId)) {
      throw new Error(`Invalid reference in ${label} ${record.id}: user ${record.userId} does not exist`);
    }
  }

  for (const record of data.balances) {
    requireUser(record, 'balance');
  }
  for (const record of data.transactions) {
    requireUser(record, 'transaction');
  }
  for (const record of data.purchases) {
    requireUser(record, 'purchase');
  }
  for (const record of data.packages) {
    requireUser(record, 'package');
  }
  for (const record of data.stickers) {
    requireUser(record, 'sticker');
    if (record.packageId && !packageIds.has(record.packageId)) {
      throw new Error(`Invalid reference in sticker ${record.id}: package ${record.packageId} does not exist`);
    }
  }
  for (const record of data['generation-jobs']) {
    requireUser(record, 'generation job');
    if (!stickerIds.has(record.stickerId)) {
      throw new Error(`Invalid reference in generation job ${record.id}: sticker ${record.stickerId} does not exist`);
    }
    if (record.packageId && !packageIds.has(record.packageId)) {
      throw new Error(`Invalid reference in generation job ${record.id}: package ${record.packageId} does not exist`);
    }
  }
  for (const record of data.sessions) {
    requireUser(record, 'session');
  }
}

function validateAndSummarize(data) {
  for (const user of data.users) validateUser(user);
  for (const tx of data.transactions) validateTransaction(tx);
  for (const purchase of data.purchases) validatePurchase(purchase);
  for (const sticker of data.stickers) validateSticker(sticker);
  for (const pkg of data.packages) validatePackage(pkg);
  for (const job of data['generation-jobs']) validateJob(job);
  for (const session of data.sessions) validateSession(session);

  validateReferences(data);

  const checksum = computeChecksum(data);
  const summary = {
    users: data.users.length,
    balances: data.balances.length,
    transactions: data.transactions.length,
    purchases: data.purchases.length,
    stickers: data.stickers.length,
    packages: data.packages.length,
    generationJobs: data['generation-jobs'].length,
    sessions: data.sessions.length,
    balanceTotals: data.balances.reduce((acc, b) => {
      acc.stickerDollars += Number(b.stickerDollars) || 0;
      acc.totalPurchased += Number(b.totalPurchased) || 0;
      acc.totalSpent += Number(b.totalSpent) || 0;
      return acc;
    }, { stickerDollars: 0, totalPurchased: 0, totalSpent: 0 }),
    ledgerTotal: data.transactions.reduce((sum, t) => sum + (Number(t.amount) || 0), 0),
    purchaseTotal: data.purchases.reduce((sum, p) => sum + (Number(p.stickerAmount) || 0), 0),
    checksum
  };
  return summary;
}

function computeChecksum(data) {
  const allRecords = [
    ...data.users,
    ...data.balances,
    ...data.transactions,
    ...data.purchases,
    ...data.stickers,
    ...data.packages,
    ...data['generation-jobs'],
    ...data.sessions
  ];
  const canonical = allRecords
    .slice()
    .sort((a, b) => String(a.id).localeCompare(String(b.id)))
    .map(r => JSON.stringify(r, Object.keys(r).sort()));
  return createHash('sha256').update(canonical.join('\n')).digest('hex');
}

function toDate(value, fallback = new Date()) {
  if (!value) return fallback;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return fallback;
  return d;
}

async function importData(prisma, data, summary) {
  const existing = await prisma.user.count();
  summary.existingUsersBefore = existing;

  // Users
  for (const user of data.users) {
    await prisma.user.upsert({
      where: { id: user.id },
      update: {
        email: user.email,
        name: user.name ?? null,
        updatedAt: toDate(user.updatedAt)
      },
      create: {
        id: user.id,
        email: user.email,
        name: user.name ?? null,
        createdAt: toDate(user.createdAt),
        updatedAt: toDate(user.updatedAt)
      }
    });

    if (user.googleId) {
      await prisma.authIdentity.upsert({
        where: { provider_subject: { provider: 'GOOGLE', subject: user.googleId } },
        update: { userId: user.id },
        create: {
          userId: user.id,
          provider: 'GOOGLE',
          subject: user.googleId
        }
      });
    }
  }

  // Balances
  for (const balance of data.balances) {
    await prisma.balance.upsert({
      where: { userId: balance.userId },
      update: {
        stickerDollars: balance.stickerDollars ?? 0,
        totalPurchased: balance.totalPurchased ?? 0,
        totalSpent: balance.totalSpent ?? 0,
        updatedAt: toDate(balance.updatedAt)
      },
      create: {
        userId: balance.userId,
        stickerDollars: balance.stickerDollars ?? 0,
        totalPurchased: balance.totalPurchased ?? 0,
        totalSpent: balance.totalSpent ?? 0,
        createdAt: toDate(balance.createdAt),
        updatedAt: toDate(balance.updatedAt)
      }
    });
  }

  // Transactions (ledger entries)
  for (const tx of data.transactions) {
    await prisma.ledgerEntry.upsert({
      where: { id: tx.id },
      update: {
        type: tx.type,
        amount: tx.amount,
        balanceAfter: tx.balanceAfter ?? 0,
        idempotencyKey: tx.providerTransactionId || null,
        metadata: tx.metadata || {},
        createdAt: toDate(tx.createdAt)
      },
      create: {
        id: tx.id,
        userId: tx.userId,
        type: tx.type,
        amount: tx.amount,
        balanceAfter: tx.balanceAfter ?? 0,
        idempotencyKey: tx.providerTransactionId || null,
        metadata: tx.metadata || {},
        createdAt: toDate(tx.createdAt)
      }
    });
  }

  // Purchases
  for (const purchase of data.purchases) {
    const metadata = {
      ...(purchase.metadata || {}),
      transactionId: purchase.transactionId ?? null,
      fraudFlags: purchase.fraudFlags ?? [],
      riskScore: purchase.riskScore ?? 0
    };
    await prisma.purchase.upsert({
      where: { id: purchase.id },
      update: {
        provider: purchase.provider,
        productId: purchase.productId,
        purchaseTokenHash: hashToken(purchase.purchaseToken),
        status: purchase.status || 'PENDING',
        stickerAmount: purchase.stickerAmount,
        metadata,
        verifiedAt: purchase.verifiedAt ? toDate(purchase.verifiedAt) : null,
        createdAt: toDate(purchase.createdAt)
      },
      create: {
        id: purchase.id,
        userId: purchase.userId,
        provider: purchase.provider,
        productId: purchase.productId,
        purchaseTokenHash: hashToken(purchase.purchaseToken),
        status: purchase.status || 'PENDING',
        stickerAmount: purchase.stickerAmount,
        metadata,
        verifiedAt: purchase.verifiedAt ? toDate(purchase.verifiedAt) : null,
        createdAt: toDate(purchase.createdAt)
      }
    });
  }

  // Packages
  for (const pkg of data.packages) {
    await prisma.package.upsert({
      where: { id: pkg.id },
      update: {
        name: pkg.name,
        author: pkg.author ?? null,
        icon: pkg.icon ?? null,
        description: pkg.description ?? null,
        isPublic: pkg.isPublic ?? false,
        stickerCount: pkg.stickerCount ?? 0,
        category: pkg.category ?? null,
        tags: pkg.tags ?? [],
        platform: pkg.platform ?? null,
        packType: (pkg.packType || 'static').toUpperCase(),
        trayIconUrl: pkg.trayIconUrl ?? null,
        exportStatus: (pkg.exportStatus || 'pending').toUpperCase(),
        whatsappReady: pkg.whatsappReady ?? false,
        exportError: pkg.exportError ?? null,
        updatedAt: toDate(pkg.updatedAt)
      },
      create: {
        id: pkg.id,
        userId: pkg.userId,
        name: pkg.name,
        author: pkg.author ?? null,
        icon: pkg.icon ?? null,
        description: pkg.description ?? null,
        isPublic: pkg.isPublic ?? false,
        stickerCount: pkg.stickerCount ?? 0,
        category: pkg.category ?? null,
        tags: pkg.tags ?? [],
        platform: pkg.platform ?? null,
        packType: (pkg.packType || 'static').toUpperCase(),
        trayIconUrl: pkg.trayIconUrl ?? null,
        exportStatus: (pkg.exportStatus || 'pending').toUpperCase(),
        whatsappReady: pkg.whatsappReady ?? false,
        exportError: pkg.exportError ?? null,
        createdAt: toDate(pkg.createdAt),
        updatedAt: toDate(pkg.updatedAt)
      }
    });
  }

  // Stickers
  for (const sticker of data.stickers) {
    await prisma.sticker.upsert({
      where: { id: sticker.id },
      update: {
        userId: sticker.userId,
        packageId: sticker.packageId || null,
        name: sticker.name ?? null,
        imageUrl: sticker.imageUrl ?? null,
        thumbnailUrl: sticker.thumbnailUrl ?? null,
        webpUrl: sticker.webpUrl ?? null,
        animatedWebpUrl: sticker.animatedWebpUrl ?? null,
        whatsappWebpUrl: sticker.whatsappWebpUrl ?? null,
        replicateId: sticker.replicateId ?? null,
        status: (sticker.status || 'pending').toUpperCase(),
        prompt: sticker.prompt ?? null,
        cost: sticker.cost ?? 1,
        width: sticker.width ?? null,
        height: sticker.height ?? null,
        durationMs: sticker.durationMs ?? null,
        sizeBytes: sticker.sizeBytes ?? null,
        mimeType: sticker.mimeType ?? null,
        exportStatus: (sticker.exportStatus || 'pending').toUpperCase(),
        exportError: sticker.exportError ?? null,
        errorMessage: sticker.errorMessage ?? null,
        updatedAt: toDate(sticker.updatedAt)
      },
      create: {
        id: sticker.id,
        userId: sticker.userId,
        packageId: sticker.packageId || null,
        name: sticker.name ?? null,
        imageUrl: sticker.imageUrl ?? null,
        thumbnailUrl: sticker.thumbnailUrl ?? null,
        webpUrl: sticker.webpUrl ?? null,
        animatedWebpUrl: sticker.animatedWebpUrl ?? null,
        whatsappWebpUrl: sticker.whatsappWebpUrl ?? null,
        replicateId: sticker.replicateId ?? null,
        status: (sticker.status || 'pending').toUpperCase(),
        prompt: sticker.prompt ?? null,
        cost: sticker.cost ?? 1,
        width: sticker.width ?? null,
        height: sticker.height ?? null,
        durationMs: sticker.durationMs ?? null,
        sizeBytes: sticker.sizeBytes ?? null,
        mimeType: sticker.mimeType ?? null,
        exportStatus: (sticker.exportStatus || 'pending').toUpperCase(),
        exportError: sticker.exportError ?? null,
        errorMessage: sticker.errorMessage ?? null,
        createdAt: toDate(sticker.createdAt),
        updatedAt: toDate(sticker.updatedAt)
      }
    });
  }

  // Generation jobs
  for (const job of data['generation-jobs']) {
    await prisma.generationJob.upsert({
      where: { id: job.id },
      update: {
        userId: job.userId,
        type: job.type.toUpperCase(),
        status: (job.status || 'queued').toUpperCase(),
        currentStep: job.currentStep || 'queued',
        progress: job.progress ?? 0,
        packageId: job.packageId || null,
        stickerId: job.stickerId,
        input: job.input || {},
        result: job.result ?? null,
        provider: job.provider ?? null,
        cost: job.cost ?? 1,
        errorMessage: job.errorMessage ?? null,
        updatedAt: toDate(job.updatedAt)
      },
      create: {
        id: job.id,
        userId: job.userId,
        type: job.type.toUpperCase(),
        status: (job.status || 'queued').toUpperCase(),
        currentStep: job.currentStep || 'queued',
        progress: job.progress ?? 0,
        packageId: job.packageId || null,
        stickerId: job.stickerId,
        input: job.input || {},
        result: job.result ?? null,
        provider: job.provider ?? null,
        cost: job.cost ?? 1,
        errorMessage: job.errorMessage ?? null,
        createdAt: toDate(job.createdAt),
        updatedAt: toDate(job.updatedAt)
      }
    });
  }

  // Sessions
  for (const session of data.sessions) {
    await prisma.authSession.upsert({
      where: { id: session.id },
      update: {
        userId: session.userId,
        refreshTokenHash: session.refreshTokenHash,
        family: session.family,
        expiresAt: toDate(session.expiresAt),
        rotatedTo: session.rotatedTo || null,
        revokedAt: session.revokedAt ? toDate(session.revokedAt) : null,
        metadata: session.metadata || {}
      },
      create: {
        id: session.id,
        userId: session.userId,
        refreshTokenHash: session.refreshTokenHash,
        family: session.family,
        expiresAt: toDate(session.expiresAt),
        rotatedTo: session.rotatedTo || null,
        revokedAt: session.revokedAt ? toDate(session.revokedAt) : null,
        metadata: session.metadata || {},
        createdAt: toDate(session.createdAt)
      }
    });
  }

  const after = await prisma.user.count();
  summary.insertedUsers = after - summary.existingUsersBefore;
  summary.duplicateUsers = data.users.length - summary.insertedUsers;
}

async function main() {
  const args = parseArgs(process.argv);
  const data = await loadSource(args.source);
  const summary = validateAndSummarize(data);

  const prisma = getPrismaClient();

  if (!args.commit) {
    console.log('DRY-RUN: no data was written.');
    console.log('Add --commit to persist these records to PostgreSQL.');
    console.log('');
    console.log(JSON.stringify(summary, null, 2));
    await disconnectPrisma();
    return;
  }

  await prisma.$transaction(async (tx) => {
    await importData(tx, data, summary);
  });

  console.log('IMPORTED: records written to PostgreSQL.');
  console.log(JSON.stringify(summary, null, 2));
  await disconnectPrisma();
}

main().catch(async (err) => {
  console.error('Import failed:', err.message);
  await disconnectPrisma().catch(() => {});
  process.exit(1);
});

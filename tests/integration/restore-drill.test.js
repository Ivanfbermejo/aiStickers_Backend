import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { cp, mkdir, readdir, readFile, unlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PrismaClient } from '@prisma/client';
import { S3AssetStorage } from '../../src/infrastructure/storage/s3-asset-storage.js';
import { hasTestDatabase, withDatabaseName } from '../helpers/postgres.js';

const execFileAsync = promisify(execFile);
const isCI = process.env.CI === 'true';
const useMinio = process.env.RUN_MINIO_INTEGRATION === 'true';
const minioEndpoint = process.env.MINIO_ENDPOINT || 'http://127.0.0.1:9000';
const minioBucket = process.env.MINIO_BUCKET || 'aistickers-private-assets';
const minioRegion = process.env.MINIO_REGION || 'us-east-1';
const minioAccessKey = process.env.MINIO_ACCESS_KEY_ID || 'minioadmin';
const minioSecretKey = process.env.MINIO_SECRET_ACCESS_KEY || 'minioadmin123';

async function commandExists(cmd) {
  try {
    await execFileAsync('which', [cmd]);
    return true;
  } catch {
    return false;
  }
}

function pgEnv(databaseUrl) {
  const url = new URL(databaseUrl);
  return {
    PGPASSWORD: decodeURIComponent(url.password),
    PGHOST: url.hostname,
    PGPORT: url.port || '5432',
    PGUSER: decodeURIComponent(url.username),
    PGDATABASE: url.pathname.replace(/^\//, '') || ''
  };
}

async function psql(databaseUrl, sql) {
  const { stdout } = await execFileAsync('psql', ['-v', 'ON_ERROR_STOP=1', '-t', '-A', '-c', sql], {
    env: { ...process.env, ...pgEnv(databaseUrl) }
  });
  return stdout.trim();
}

async function createDatabase(baseUrl, name) {
  const base = withDatabaseName(baseUrl, 'postgres');
  await psql(base, `CREATE DATABASE "${name}"`);
}

async function dropDatabase(baseUrl, name) {
  const base = withDatabaseName(baseUrl, 'postgres');
  try {
    await psql(base, `DROP DATABASE IF EXISTS "${name}"`);
  } catch {
    // Cleanup must not hide the assertion that caused the test to fail.
  }
}

async function runPrismaMigrate(databaseUrl) {
  const projectRoot = path.resolve(process.cwd());
  const prismaCli = path.join(projectRoot, 'node_modules/prisma/build/index.js');
  const schemaPath = path.join(projectRoot, 'prisma/schema.prisma');
  await execFileAsync(process.execPath, [prismaCli, 'migrate', 'deploy', `--schema=${schemaPath}`], {
    cwd: projectRoot,
    env: { ...process.env, DATABASE_URL: databaseUrl }
  });
}

function createPrisma(databaseUrl) {
  return new PrismaClient({ datasources: { db: { url: databaseUrl } } });
}

function createMinioStorage(prefix) {
  return new S3AssetStorage({
    endpoint: minioEndpoint,
    bucket: minioBucket,
    region: minioRegion,
    accessKeyId: minioAccessKey,
    secretAccessKey: minioSecretKey,
    forcePathStyle: true,
    prefix
  });
}

let prerequisitesMet = false;
let prerequisiteError = null;

async function checkPrerequisites() {
  if (!hasTestDatabase()) {
    prerequisiteError = 'DATABASE_URL is not set';
    return false;
  }
  const missing = [];
  for (const cmd of ['pg_dump', 'pg_restore', 'psql']) {
    if (!(await commandExists(cmd))) missing.push(cmd);
  }
  if (missing.length > 0) {
    prerequisiteError = `missing required tool(s): ${missing.join(', ')}`;
    return false;
  }
  return true;
}

prerequisitesMet = await checkPrerequisites();

describe.skipIf(!isCI && !prerequisitesMet)('restore drill', () => {
  const testRun = Date.now();
  const sourceDbName = `aistickers_restore_src_${testRun}`;
  const targetDbName = `aistickers_restore_tgt_${testRun}`;
  let baseUrl;
  let sourceDbUrl;
  let targetDbUrl;
  let sourceAssets;
  let targetAssets;
  let backupRoot;
  let backupPath;
  let tmpRoot;
  let assetPrefix;
  let storage;

  async function runRestore(targetUrl, targetDir, targetEnv = 'test', backup = backupPath) {
    const childEnv = {
      ...process.env,
      NODE_ENV: 'test',
      LOG_LEVEL: 'info',
      RESTORE_TARGET_ENV: targetEnv,
      ASSET_STORAGE_DRIVER: useMinio ? 's3' : 'local',
      ASSET_STORAGE_LOCAL_BASE_DIR: targetDir,
      ASSET_STORAGE_BUCKET: minioBucket,
      ASSET_STORAGE_PREFIX: assetPrefix,
      ASSET_STORAGE_ENDPOINT: minioEndpoint,
      ASSET_STORAGE_REGION: minioRegion,
      ASSET_STORAGE_ACCESS_KEY_ID: minioAccessKey,
      ASSET_STORAGE_SECRET_ACCESS_KEY: minioSecretKey,
      ASSET_STORAGE_FORCE_PATH_STYLE: 'true',
      DATA_DIR: path.join(tmpRoot, 'target-data')
    };
    return execFileAsync(process.execPath, [
      'scripts/restore.js',
      '--backup', backup,
      '--target-db', targetUrl,
      '--target-assets', targetDir
    ], { env: childEnv });
  }

  async function expectRestoreFailure(promise, pattern = null) {
    let error;
    try {
      await promise;
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeDefined();
    if (pattern) expect(`${error.stdout || ''}${error.stderr || ''}`).toMatch(pattern);
  }

  beforeAll(async () => {
    if (isCI && !prerequisitesMet) {
      throw new Error(`restore drill prerequisites not met in CI: ${prerequisiteError}`);
    }
    if (!prerequisitesMet) return;

    baseUrl = process.env.DATABASE_URL;
    sourceDbUrl = withDatabaseName(baseUrl, sourceDbName);
    targetDbUrl = withDatabaseName(baseUrl, targetDbName);
    tmpRoot = mkdtempSync(path.join(tmpdir(), 'aistickers-restore-'));
    sourceAssets = path.join(tmpRoot, 'source-assets');
    targetAssets = path.join(tmpRoot, 'target-assets');
    backupRoot = path.join(tmpRoot, 'backups');
    assetPrefix = `restore-drill/${randomUUID()}`;
    storage = useMinio ? createMinioStorage(assetPrefix) : null;

    await dropDatabase(baseUrl, sourceDbName);
    await dropDatabase(baseUrl, targetDbName);
    await createDatabase(baseUrl, sourceDbName);
    // The restore target is deliberately not migrated. pg_restore must create
    // the schema, and an already-migrated target would violate the safety test.
    await runPrismaMigrate(sourceDbUrl);

    const prisma = createPrisma(sourceDbUrl);
    try {
      const user = await prisma.user.create({ data: { email: 'restore-test@example.com', name: 'Restore Test' } });
      await prisma.balance.create({
        data: { userId: user.id, stickerDollars: 100, totalPurchased: 100, totalSpent: 0 }
      });
      await prisma.ledgerEntry.create({
        data: { userId: user.id, type: 'PURCHASE', amount: 100, balanceAfter: 100, metadata: { note: 'seed' } }
      });
      await prisma.purchase.create({
        data: {
          userId: user.id,
          provider: 'GOOGLE_PLAY',
          productId: 'pack_small',
          purchaseTokenHash: 'hash123',
          stickerAmount: 100,
          status: 'CREDITED'
        }
      });
      const pkg = await prisma.package.create({
        data: { userId: user.id, name: 'Restore Test Pack', packType: 'STATIC' }
      });
      const sticker = await prisma.sticker.create({
        data: { userId: user.id, packageId: pkg.id, status: 'PENDING' }
      });
      await prisma.generationJob.create({
        data: {
          userId: user.id,
          packageId: pkg.id,
          stickerId: sticker.id,
          type: 'IMAGE_STICKER',
          status: 'COMPLETED',
          provider: 'replicate',
          input: {},
          cost: 1
        }
      });
    } finally {
      await prisma.$disconnect();
    }

    const assetBody = Buffer.from('restore-drill-asset');
    if (useMinio) {
      await storage.putObject('user-asset/image.png', assetBody, { mimeType: 'image/png' });
      expect(await storage.objectExists('user-asset/image.png')).toBe(true);
    } else {
      await mkdir(path.join(sourceAssets, 'user-asset'), { recursive: true });
      writeFileSync(path.join(sourceAssets, 'user-asset', 'image.png'), assetBody);
    }

    const backupOut = path.join(backupRoot, 'test-backup');
    await execFileAsync(process.execPath, ['scripts/backup.js', '--output', backupOut], {
      env: {
        ...process.env,
        NODE_ENV: 'test',
        DATABASE_URL: sourceDbUrl,
        ASSET_STORAGE_DRIVER: useMinio ? 's3' : 'local',
        ASSET_STORAGE_LOCAL_BASE_DIR: sourceAssets,
        ASSET_STORAGE_BUCKET: minioBucket,
        ASSET_STORAGE_PREFIX: assetPrefix,
        ASSET_STORAGE_ENDPOINT: minioEndpoint,
        ASSET_STORAGE_REGION: minioRegion,
        ASSET_STORAGE_ACCESS_KEY_ID: minioAccessKey,
        ASSET_STORAGE_SECRET_ACCESS_KEY: minioSecretKey,
        ASSET_STORAGE_FORCE_PATH_STYLE: 'true',
        DATA_DIR: path.join(tmpRoot, 'data')
      }
    });
    const entries = await readdir(backupOut);
    expect(entries).toHaveLength(1);
    backupPath = path.join(backupOut, entries[0]);
  }, 180000);

  afterAll(async () => {
    if (storage) await storage.deleteObject('user-asset/image.png').catch(() => {});
    if (baseUrl) {
      await dropDatabase(baseUrl, sourceDbName);
      await dropDatabase(baseUrl, targetDbName);
    }
    if (tmpRoot) rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('validates safe targets, refuses incomplete/non-empty restores, and restores PostgreSQL plus assets', async () => {
    if (!prerequisitesMet) return;
    await createDatabase(baseUrl, targetDbName);

    await expectRestoreFailure(runRestore(targetDbUrl, targetAssets, 'production'), /test or staging|production/i);
    expect(await psql(targetDbUrl, "SELECT count(*) FROM pg_catalog.pg_tables WHERE schemaname = 'public'")).toBe('0');

    const incompleteBackup = path.join(tmpRoot, 'incomplete-backup');
    await cp(backupPath, incompleteBackup, { recursive: true });
    const incompleteEntries = await readdir(incompleteBackup);
    const assetArtifact = incompleteEntries.find((name) => name === 'assets.tar.gz' || name === 'assets.tar.gz.enc');
    await unlink(path.join(incompleteBackup, assetArtifact));
    await expectRestoreFailure(runRestore(targetDbUrl, targetAssets, 'test', incompleteBackup), /missing/i);
    expect(await psql(targetDbUrl, "SELECT count(*) FROM pg_catalog.pg_tables WHERE schemaname = 'public'")).toBe('0');

    if (useMinio) {
      await storage.deleteObject('user-asset/image.png');
      expect(await storage.objectExists('user-asset/image.png')).toBe(false);
    }

    await psql(targetDbUrl, 'CREATE TABLE restore_guard (id integer)');
    await expectRestoreFailure(runRestore(targetDbUrl, targetAssets));
    expect(await psql(targetDbUrl, "SELECT count(*) FROM pg_catalog.pg_tables WHERE schemaname = 'public' AND tablename = 'restore_guard'")).toBe('1');
    await psql(targetDbUrl, 'DROP TABLE restore_guard');

    await runRestore(targetDbUrl, targetAssets);

    const targetPrisma = createPrisma(targetDbUrl);
    try {
      const [userCount, balanceCount, balanceTotal, ledgerCount, ledgerSum, purchaseCount, packageCount, stickerCount, jobCount] = await Promise.all([
        targetPrisma.user.count(),
        targetPrisma.balance.count(),
        targetPrisma.balance.aggregate({ _sum: { stickerDollars: true } }).then((r) => r._sum.stickerDollars || 0),
        targetPrisma.ledgerEntry.count(),
        targetPrisma.ledgerEntry.aggregate({ _sum: { amount: true } }).then((r) => r._sum.amount || 0),
        targetPrisma.purchase.count(),
        targetPrisma.package.count(),
        targetPrisma.sticker.count(),
        targetPrisma.generationJob.count()
      ]);
      expect({ userCount, balanceCount, balanceTotal, ledgerCount, ledgerSum, purchaseCount, packageCount, stickerCount, jobCount })
        .toEqual({ userCount: 1, balanceCount: 1, balanceTotal: 100, ledgerCount: 1, ledgerSum: 100, purchaseCount: 1, packageCount: 1, stickerCount: 1, jobCount: 1 });
    } finally {
      await targetPrisma.$disconnect();
    }

    if (useMinio) {
      expect(await storage.objectExists('user-asset/image.png')).toBe(true);
      const restored = await storage.getObject('user-asset/image.png');
      expect(restored.buffer.toString()).toBe('restore-drill-asset');
    } else {
      expect(existsSync(path.join(targetAssets, 'user-asset', 'image.png'))).toBe(true);
    }

    const reportPath = path.join(backupPath, 'restore-report.json');
    expect(existsSync(reportPath)).toBe(true);
    const reportRaw = await readFile(reportPath, 'utf8');
    const report = JSON.parse(reportRaw);
    expect(report.database.userCount).toBe(1);
    expect(report.database.balanceTotal).toBe(100);
    expect(report.database.ledgerSum).toBe(100);
    expect(report.assets.objectCount).toBe(1);
    expect(reportRaw).not.toContain('restore-test@example.com');
    expect(reportRaw).not.toMatch(/[^\s@]+@[^\s@]+\.[^\s@]+/);
  }, 240000);
});

#!/usr/bin/env node
/**
 * Backup script for PostgreSQL and assets.
 *
 * Credentials are read only from environment variables. Secrets are never logged.
 * Production backups require encryption and S3 versioning.
 */

import { writeFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { env } from '../src/config/env.js';
import { rootLogger } from '../src/infrastructure/observability/logger.js';
import {
  buildManifest,
  compressTar,
  dumpDatabase,
  ensureDir,
  encryptFile,
  syncS3AssetsToLocal
} from './lib/backup-restore.js';

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--output' && argv[i + 1]) {
      args.output = argv[i + 1];
      i += 1;
    }
  }
  return args;
}

async function backupAssets(outputDir) {
  if (env.ASSET_STORAGE_DRIVER === 'local') {
    const baseDir = env.ASSET_STORAGE_LOCAL_BASE_DIR || env.DATA_DIR;
    if (!existsSync(baseDir)) {
      rootLogger.warn({ baseDir }, 'asset base directory does not exist, creating empty assets backup');
      await ensureDir(baseDir);
    }
    const tarPath = path.join(outputDir, 'assets.tar.gz');
    await compressTar(baseDir, tarPath);
    return tarPath;
  }

  if (env.ASSET_STORAGE_DRIVER === 's3') {
    const assetDir = path.join(outputDir, 'assets');
    await ensureDir(assetDir);
    await syncS3AssetsToLocal({
      bucket: env.ASSET_STORAGE_BUCKET,
      prefix: env.ASSET_STORAGE_PREFIX,
      endpoint: env.ASSET_STORAGE_ENDPOINT,
      region: env.ASSET_STORAGE_REGION,
      accessKeyId: env.ASSET_STORAGE_ACCESS_KEY_ID,
      secretAccessKey: env.ASSET_STORAGE_SECRET_ACCESS_KEY,
      forcePathStyle: env.ASSET_STORAGE_FORCE_PATH_STYLE
    }, assetDir);
    const tarPath = path.join(outputDir, 'assets.tar.gz');
    await compressTar(assetDir, tarPath);
    await rm(assetDir, { recursive: true, force: true });
    return tarPath;
  }

  throw new Error(`Unsupported ASSET_STORAGE_DRIVER: ${env.ASSET_STORAGE_DRIVER}`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const outputRoot = args.output || './backups/staging';
  const outputDir = path.join(outputRoot, timestamp);
  const encryptionKey = process.env.BACKUP_ENCRYPTION_KEY;

  if (env.NODE_ENV === 'production') {
    if (!encryptionKey) {
      throw new Error('BACKUP_ENCRYPTION_KEY is required for production backups');
    }
    if (process.env.BACKUP_S3_VERSIONING !== 'true') {
      throw new Error('BACKUP_S3_VERSIONING=true is required for production backups');
    }
  }

  if (!env.DATABASE_URL) {
    throw new Error('DATABASE_URL must be set');
  }

  await ensureDir(outputDir);
  rootLogger.info({ backupDir: outputDir, nodeEnv: env.NODE_ENV }, 'starting backup');

  // Database backup: PostgreSQL custom-format dump (pg_dump -Fc), never gzipped.
  const dbDumpPath = path.join(outputDir, 'db.dump');
  await dumpDatabase(dbDumpPath, env.DATABASE_URL);

  if (encryptionKey) {
    const encPath = `${dbDumpPath}.enc`;
    await encryptFile(dbDumpPath, encPath, encryptionKey);
    await rm(dbDumpPath);
  }

  // Asset backup
  const assetTarPath = await backupAssets(outputDir);
  if (encryptionKey) {
    const encPath = `${assetTarPath}.enc`;
    await encryptFile(assetTarPath, encPath, encryptionKey);
    await rm(assetTarPath);
  }

  const manifest = await buildManifest(outputDir);
  await writeFile(path.join(outputDir, 'manifest.json'), JSON.stringify(manifest, null, 2));

  rootLogger.info({ backupDir: outputDir, files: manifest.files.length }, 'backup complete');
}

main().catch((err) => {
  rootLogger.error({ err }, 'backup failed');
  process.exitCode = 1;
});

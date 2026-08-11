#!/usr/bin/env node
/**
 * Restore script for PostgreSQL and private assets.
 *
 * A restore is intentionally limited to test and staging. The target database
 * and asset destination must already exist and be empty. The script never
 * drops schemas or deletes destination contents.
 */

import { randomUUID } from 'node:crypto';
import { writeFile, rm, readdir, stat, rename } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PrismaClient } from '@prisma/client';
import { env } from '../src/config/env.js';
import { rootLogger } from '../src/infrastructure/observability/logger.js';
import {
  countS3Assets,
  decryptFile,
  ensureDir,
  extractTar,
  getManifestArtifact,
  isDatabaseEmpty,
  parsePostgresUrl,
  restoreDatabase,
  syncLocalAssetsToS3,
  validatePostgresDump,
  validateTarArchive,
  verifyManifest
} from './lib/backup-restore.js';

const ALLOWED_TARGET_ENVS = new Set(['test', 'staging']);

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--backup' && argv[i + 1]) {
      args.backup = argv[i + 1];
      i += 1;
    } else if (argv[i] === '--target-db' && argv[i + 1]) {
      args.targetDb = argv[i + 1];
      i += 1;
    } else if (argv[i] === '--target-assets' && argv[i + 1]) {
      args.targetAssets = argv[i + 1];
      i += 1;
    }
  }
  return args;
}

function looksLikeProduction(parsed) {
  const target = `${parsed.host}/${parsed.database}`.toLowerCase();
  return target.includes('prod') || target.includes('production');
}

function assertRestoreAllowed(parsed) {
  const targetEnv = process.env.RESTORE_TARGET_ENV;
  if (!ALLOWED_TARGET_ENVS.has(targetEnv)) {
    throw new Error('RESTORE_TARGET_ENV must be set to test or staging. Refusing to restore.');
  }
  if (looksLikeProduction(parsed)) {
    throw new Error('Refusing to restore onto a production host or database.');
  }
}

async function assertLocalDirectoryEmpty(targetDir) {
  if (!existsSync(targetDir)) return;
  const targetStat = await stat(targetDir);
  if (!targetStat.isDirectory()) {
    throw new Error('Target asset destination must be a directory and must be empty');
  }
  const entries = await readdir(targetDir);
  if (entries.length > 0) {
    throw new Error('Target asset destination is not empty');
  }
}

function assetStorageConfig() {
  return {
    bucket: env.ASSET_STORAGE_BUCKET,
    prefix: env.ASSET_STORAGE_PREFIX,
    endpoint: env.ASSET_STORAGE_ENDPOINT,
    region: env.ASSET_STORAGE_REGION,
    accessKeyId: env.ASSET_STORAGE_ACCESS_KEY_ID,
    secretAccessKey: env.ASSET_STORAGE_SECRET_ACCESS_KEY,
    forcePathStyle: env.ASSET_STORAGE_FORCE_PATH_STYLE
  };
}

async function assertAssetDestinationEmpty(targetAssets) {
  await assertLocalDirectoryEmpty(targetAssets);
  if (env.ASSET_STORAGE_DRIVER === 's3') {
    const objectCount = await countS3Assets(assetStorageConfig());
    if (objectCount > 0) {
      throw new Error('Target asset storage is not empty');
    }
  } else if (env.ASSET_STORAGE_DRIVER !== 'local') {
    throw new Error(`Unsupported ASSET_STORAGE_DRIVER: ${env.ASSET_STORAGE_DRIVER}`);
  }
}

async function materializeArtifact(artifact, key, tempDir) {
  if (!artifact.encrypted) return artifact.path;
  const encryptionKey = process.env.BACKUP_ENCRYPTION_KEY;
  if (!encryptionKey) throw new Error('BACKUP_ENCRYPTION_KEY is required for an encrypted backup');
  const outputPath = path.join(tempDir, `${key}-${randomUUID()}`);
  await decryptFile(artifact.path, outputPath, encryptionKey);
  return outputPath;
}

async function commitLocalAssets(stagingDir, targetDir) {
  await ensureDir(path.dirname(targetDir));
  if (!existsSync(targetDir)) {
    await rename(stagingDir, targetDir);
    return;
  }

  // The destination was checked empty before restore. Move it aside only for
  // the final same-filesystem rename, and restore it if the promotion fails.
  const emptyDestination = path.join(path.dirname(targetDir), `.restore-empty-${randomUUID()}`);
  await rename(targetDir, emptyDestination);
  try {
    await rename(stagingDir, targetDir);
  } catch (error) {
    await rename(emptyDestination, targetDir).catch(() => {});
    throw error;
  }
  await rm(emptyDestination, { recursive: true, force: true });
}

async function restoreAssets(tarPath, targetAssets) {
  const stagingDir = await fsTempDirectory('aistickers-restore-assets-');
  try {
    await extractTar(tarPath, stagingDir);
    if (env.ASSET_STORAGE_DRIVER === 'local') {
      await commitLocalAssets(stagingDir, targetAssets);
    } else if (env.ASSET_STORAGE_DRIVER === 's3') {
      await syncLocalAssetsToS3(stagingDir, assetStorageConfig());
    } else {
      throw new Error(`Unsupported ASSET_STORAGE_DRIVER: ${env.ASSET_STORAGE_DRIVER}`);
    }
  } finally {
    await rm(stagingDir, { recursive: true, force: true });
  }
}

async function fsTempDirectory(prefix) {
  const directory = path.join(os.tmpdir(), prefix);
  await ensureDir(directory);
  const isolated = path.join(directory, randomUUID());
  await ensureDir(isolated);
  return isolated;
}

async function countLocalAssets(targetAssets) {
  if (!existsSync(targetAssets)) return 0;
  let count = 0;
  const stack = [targetAssets];
  while (stack.length > 0) {
    const current = stack.pop();
    const entries = await readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else if (entry.isFile()) count += 1;
    }
  }
  return count;
}

async function verifyRestore(targetDb, targetAssets) {
  const prisma = new PrismaClient({ datasources: { db: { url: targetDb } } });
  try {
    const [userCount, balanceCount, balanceAgg, ledgerCount, ledgerAgg, purchaseCount, generationJobCount] = await Promise.all([
      prisma.user.count(),
      prisma.balance.count(),
      prisma.balance.aggregate({ _sum: { stickerDollars: true } }),
      prisma.ledgerEntry.count(),
      prisma.ledgerEntry.aggregate({ _sum: { amount: true } }),
      prisma.purchase.count(),
      prisma.generationJob.count()
    ]);

    const objectCount = env.ASSET_STORAGE_DRIVER === 's3'
      ? await countS3Assets(assetStorageConfig())
      : await countLocalAssets(targetAssets);

    return {
      database: {
        userCount,
        balanceCount,
        balanceTotal: balanceAgg._sum.stickerDollars || 0,
        ledgerCount,
        ledgerSum: ledgerAgg._sum.amount || 0,
        purchaseCount,
        generationJobCount
      },
      assets: { objectCount }
    };
  } finally {
    await prisma.$disconnect();
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const backupDir = args.backup;
  const targetDb = args.targetDb || process.env.RESTORE_TARGET_DATABASE_URL;
  const targetAssets = args.targetAssets || process.env.RESTORE_ASSET_TARGET_DIR;

  if (!backupDir) throw new Error('--backup is required');
  if (!targetDb) throw new Error('--target-db or RESTORE_TARGET_DATABASE_URL is required');
  if (!targetAssets) throw new Error('--target-assets or RESTORE_ASSET_TARGET_DIR is required');

  const parsed = parsePostgresUrl(targetDb);
  assertRestoreAllowed(parsed);

  // No database, asset destination, or backup-derived plaintext is touched
  // until every integrity and format check has completed.
  const manifest = await verifyManifest(backupDir);
  const dbArtifact = getManifestArtifact(backupDir, manifest, 'db.dump');
  const assetsArtifact = getManifestArtifact(backupDir, manifest, 'assets.tar.gz');
  const tempDir = await fsTempDirectory('aistickers-restore-validated-');

  try {
    const dbPath = await materializeArtifact(dbArtifact, 'db-dump', tempDir);
    const tarPath = await materializeArtifact(assetsArtifact, 'assets', tempDir);
    await validatePostgresDump(dbPath, targetDb);
    await validateTarArchive(tarPath);
    await assertAssetDestinationEmpty(targetAssets);

    if (!await isDatabaseEmpty(targetDb)) {
      throw new Error('Target database is not empty');
    }

    rootLogger.info({ backupDir, targetDbHost: parsed.host, targetDbName: parsed.database }, 'starting restore');
    await restoreDatabase(dbPath, targetDb);
    await restoreAssets(tarPath, targetAssets);

    const report = await verifyRestore(targetDb, targetAssets);
    const reportPath = path.join(backupDir, 'restore-report.json');
    await writeFile(reportPath, JSON.stringify({ verifiedAt: new Date().toISOString(), ...report }, null, 2));
    rootLogger.info({ report, reportPath }, 'restore complete');
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

main().catch((err) => {
  rootLogger.error({ err }, 'restore failed');
  process.exitCode = 1;
});

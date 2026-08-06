#!/usr/bin/env node
/**
 * T07 — Migrador de /uploads a almacenamiento privado de objetos.
 *
 * Dry-run is the default and performs no filesystem, object-storage or DB
 * writes. Pass --apply to copy and verify objects, then update references.
 * Source files are never deleted.
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import process from 'node:process';
import { pathToFileURL } from 'node:url';
import { env } from '../src/config/env.js';
import { createAssetStorage, buildStorageConfig } from '../src/application/storage/asset-storage.factory.js';
import { validateImageBuffer } from '../src/application/services/secure-asset.service.js';
import { getPrismaClient } from '../src/infrastructure/persistence/prisma/client.js';

const UPLOADS_DIR = path.join(env.DATA_DIR, 'uploads');
export const DRY_RUN = !process.argv.includes('--apply');

function log(...args) {
  console.log(...args);
}

export function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

export function migrationKey({ ownerId, relative, hash, format }) {
  const digest = crypto.createHash('sha256').update(`${ownerId}:${relative}:${hash}`).digest('hex');
  return `migrated_${digest}.${format}`;
}

async function* walkUploads(dir) {
  const entries = await fs.promises.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walkUploads(full);
    else yield full;
  }
}

function addReference(map, url, ownerId) {
  if (!url?.startsWith('/uploads/') || !ownerId) return;
  if (!map.has(url)) map.set(url, new Set());
  map.get(url).add(ownerId);
}

async function loadJsonReferences() {
  const references = new Map();
  for (const [name, fields] of Object.entries({
    stickers: ['imageUrl', 'thumbnailUrl', 'webpUrl', 'animatedWebpUrl', 'whatsappWebpUrl'],
    packages: ['trayIconUrl']
  })) {
    const file = path.join(env.DATA_DIR, `${name}.json`);
    if (!fs.existsSync(file)) continue;
    const data = JSON.parse(await fs.promises.readFile(file, 'utf8'));
    for (const item of Object.values(data)) {
      for (const field of fields) addReference(references, item[field], item.userId);
    }
  }
  const jobsFile = path.join(env.DATA_DIR, 'generation-jobs.json');
  if (fs.existsSync(jobsFile)) {
    const jobs = JSON.parse(await fs.promises.readFile(jobsFile, 'utf8'));
    for (const job of Object.values(jobs)) {
      for (const value of [job.input?.imageUrl, job.input?.sourceUrl, job.result?.imageUrl, job.result?.videoUrl]) {
        addReference(references, value, job.userId);
      }
    }
  }
  return references;
}

async function loadPostgresReferences() {
  const client = getPrismaClient();
  const references = new Map();
  const [stickers, packages, jobs] = await Promise.all([
    client.sticker.findMany({
      select: {
        userId: true,
        imageUrl: true,
        thumbnailUrl: true,
        webpUrl: true,
        animatedWebpUrl: true,
        whatsappWebpUrl: true
      }
    }),
    client.package.findMany({ select: { userId: true, trayIconUrl: true } }),
    client.generationJob.findMany({ select: { userId: true, input: true, result: true } })
  ]);
  for (const sticker of stickers) {
    for (const field of ['imageUrl', 'thumbnailUrl', 'webpUrl', 'animatedWebpUrl', 'whatsappWebpUrl']) {
      addReference(references, sticker[field], sticker.userId);
    }
  }
  for (const pkg of packages) addReference(references, pkg.trayIconUrl, pkg.userId);
  for (const job of jobs) {
    for (const value of [job.input?.imageUrl, job.input?.sourceUrl, job.result?.imageUrl, job.result?.videoUrl]) {
      addReference(references, value, job.userId);
    }
  }
  return references;
}

async function verifyCopiedObject(storage, key, expectedHash, expectedSize, ownerId) {
  const { buffer, metadata = {} } = await storage.getObject(key);
  if (buffer.length !== expectedSize || sha256(buffer) !== expectedHash) {
    throw new Error(`Verification failed for copied object ${key}`);
  }
  if (String(metadata.ownerId || metadata.ownerid) !== ownerId) {
    throw new Error(`Verification failed for copied object ownership ${key}`);
  }
}

export async function copyOwnedAsset({ storage, buffer, ownerId, relative, dryRun = true }) {
  const hash = sha256(buffer);
  const meta = await validateImageBuffer(buffer);
  const publicUrl = `/uploads/${relative}`;
  const key = migrationKey({ ownerId, relative, hash, format: meta.format });
  const record = {
    relative, publicUrl, ownerId, key, hash, sizeBytes: buffer.length,
    mimeType: meta.format === 'jpg' ? 'image/jpeg' : `image/${meta.format}`,
    width: meta.width, height: meta.height, skipped: false
  };
  if (dryRun) return record;
  if (!(await storage.objectExists(key))) {
    await storage.putObject(key, buffer, {
      ownerId, hash, sizeBytes: buffer.length, mimeType: record.mimeType,
      width: meta.width, height: meta.height, migratedFrom: publicUrl
    });
  }
  await verifyCopiedObject(storage, key, hash, buffer.length, ownerId);
  return record;
}

async function migrateFile(storage, filePath, owners) {
  const relative = path.relative(UPLOADS_DIR, filePath).replace(/\\/g, '/');
  const publicUrl = `/uploads/${relative}`;
  if (!owners?.size) {
    return [{ relative, publicUrl, skipped: true, reason: 'No database owner/reference found' }];
  }

  const buffer = await fs.promises.readFile(filePath);
  try {
    await validateImageBuffer(buffer);
  } catch (error) {
    return [{ relative, publicUrl, skipped: true, reason: `Not a valid image: ${error.message}` }];
  }

  const records = [];
  for (const ownerId of owners) {
    records.push(await copyOwnedAsset({ storage, buffer, ownerId, relative, dryRun: DRY_RUN }));
  }
  return records;
}

export function applyMainMetadata(item, record) {
  item.objectKey = record.key;
  item.objectHash = record.hash;
  item.objectSize = record.sizeBytes;
  item.objectMime = record.mimeType;
  item.objectWidth = record.width;
  item.objectHeight = record.height;
  for (const field of ['imageUrl', 'thumbnailUrl', 'webpUrl', 'animatedWebpUrl']) {
    if (item[field] === record.publicUrl) item[field] = null;
  }
}

export function applyGenerationReference(job, record) {
  let changed = false;
  for (const container of [job.input, job.result]) {
    if (!container || typeof container !== 'object') continue;
    for (const field of ['imageUrl', 'sourceUrl', 'videoUrl']) {
      if (container[field] === record.publicUrl) {
        container.objectKey = record.key;
        container.hash = record.hash;
        container.sizeBytes = record.sizeBytes;
        container.mimeType = record.mimeType;
        container.width = record.width;
        container.height = record.height;
        delete container[field];
        changed = true;
      }
    }
  }
  return changed;
}

async function updateJsonDatabase(records) {
  for (const name of ['stickers', 'packages', 'generation-jobs']) {
    const dbFile = path.join(env.DATA_DIR, `${name}.json`);
    if (!fs.existsSync(dbFile)) continue;
    const parsed = JSON.parse(await fs.promises.readFile(dbFile, 'utf8'));
    let updated = 0;
    for (const item of Object.values(parsed)) {
      for (const record of records) {
        if (record.skipped || record.ownerId !== item.userId) continue;
        if (name === 'stickers') {
          const mainMatch = ['imageUrl', 'thumbnailUrl', 'webpUrl', 'animatedWebpUrl']
            .some(field => item[field] === record.publicUrl);
          if (mainMatch) {
            applyMainMetadata(item, record);
            updated++;
          }
          if (item.whatsappWebpUrl === record.publicUrl) {
            item.whatsappObjectKey = record.key;
            item.whatsappObjectHash = record.hash;
            item.whatsappObjectSize = record.sizeBytes;
            item.whatsappObjectMime = record.mimeType;
            item.whatsappObjectWidth = record.width;
            item.whatsappObjectHeight = record.height;
            item.whatsappWebpUrl = null;
            updated++;
          }
        } else if (name === 'packages' && item.trayIconUrl === record.publicUrl) {
          item.trayIconObjectKey = record.key;
          item.trayIconObjectHash = record.hash;
          item.trayIconObjectSize = record.sizeBytes;
          item.trayIconObjectMime = record.mimeType;
          item.trayIconObjectWidth = record.width;
          item.trayIconObjectHeight = record.height;
          item.trayIconUrl = null;
          updated++;
        } else if (name === 'generation-jobs' && applyGenerationReference(item, record)) {
          updated++;
        }
      }
    }
    if (updated > 0) await fs.promises.writeFile(dbFile, JSON.stringify(parsed, null, 2));
    log(`  ${name}: ${updated} reference(s) updated`);
  }
}

async function updatePostgresDatabase(records) {
  const client = getPrismaClient();
  let updated = 0;
  for (const record of records) {
    if (record.skipped) continue;
    const main = await client.sticker.updateMany({
      where: {
        userId: record.ownerId,
        OR: ['imageUrl', 'thumbnailUrl', 'webpUrl', 'animatedWebpUrl'].map(field => ({ [field]: record.publicUrl }))
      },
      data: {
        objectKey: record.key,
        objectHash: record.hash,
        objectSize: record.sizeBytes,
        objectMime: record.mimeType,
        objectWidth: record.width,
        objectHeight: record.height,
        imageUrl: null,
        thumbnailUrl: null,
        webpUrl: null,
        animatedWebpUrl: null
      }
    });
    const whatsapp = await client.sticker.updateMany({
      where: { userId: record.ownerId, whatsappWebpUrl: record.publicUrl },
      data: {
        whatsappObjectKey: record.key,
        whatsappObjectHash: record.hash,
        whatsappObjectSize: record.sizeBytes,
        whatsappObjectMime: record.mimeType,
        whatsappObjectWidth: record.width,
        whatsappObjectHeight: record.height,
        whatsappWebpUrl: null
      }
    });
    const tray = await client.package.updateMany({
      where: { userId: record.ownerId, trayIconUrl: record.publicUrl },
      data: {
        trayIconObjectKey: record.key,
        trayIconObjectHash: record.hash,
        trayIconObjectSize: record.sizeBytes,
        trayIconObjectMime: record.mimeType,
        trayIconObjectWidth: record.width,
        trayIconObjectHeight: record.height,
        trayIconUrl: null
      }
    });
    const jobs = await client.generationJob.findMany({ where: { userId: record.ownerId } });
    let jobsUpdated = 0;
    for (const job of jobs) {
      const copy = { input: job.input, result: job.result };
      if (applyGenerationReference(copy, record)) {
        await client.generationJob.update({ where: { id: job.id }, data: { input: copy.input, result: copy.result } });
        jobsUpdated++;
      }
    }
    updated += main.count + whatsapp.count + tray.count + jobsUpdated;
  }
  log(`  postgres: ${updated} reference(s) updated`);
}

async function main() {
  const config = buildStorageConfig();
  const storage = DRY_RUN ? null : createAssetStorage(config);
  log(`Mode: ${DRY_RUN ? 'DRY-RUN' : 'APPLY'}`);
  log(`Storage driver: ${config.driver}`);
  log(`Uploads directory: ${UPLOADS_DIR}`);

  if (!fs.existsSync(UPLOADS_DIR)) {
    log('Uploads directory does not exist. Nothing to migrate.');
    return;
  }

  const references = env.PERSISTENCE_DRIVER === 'postgres'
    ? await loadPostgresReferences()
    : await loadJsonReferences();
  const records = [];
  for await (const filePath of walkUploads(UPLOADS_DIR)) {
    const relative = path.relative(UPLOADS_DIR, filePath).replace(/\\/g, '/');
    const publicUrl = `/uploads/${relative}`;
    const fileRecords = await migrateFile(storage, filePath, references.get(publicUrl));
    records.push(...fileRecords);
    for (const record of fileRecords) {
      log(record.skipped
        ? `  SKIP ${record.relative}: ${record.reason}`
        : `  COPY ${record.relative} -> ${record.key} owner=${record.ownerId} hash=${record.hash}`);
    }
  }

  const migrated = records.filter(record => !record.skipped);
  log(`\nSummary: ${migrated.length} owned object(s) ready from ${records.length} record(s)`);
  if (DRY_RUN) {
    log('\nDry-run complete. No objects or database rows were changed. Use --apply to migrate.');
    return;
  }
  if (migrated.length === 0) return;

  if (env.PERSISTENCE_DRIVER === 'postgres') await updatePostgresDatabase(migrated);
  else await updateJsonDatabase(migrated);
  log('\nMigration complete. Original /uploads files were not removed.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error('Migration failed:', error);
    process.exit(1);
  });
}

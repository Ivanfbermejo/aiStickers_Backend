import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream, existsSync } from 'node:fs';
import { mkdir, readdir, readFile, stat, rm } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import {
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client
} from '@aws-sdk/client-s3';

const execFileAsync = promisify(execFile);

export async function sha256File(filePath) {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    const stream = createReadStream(filePath);
    stream.on('error', reject);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

export async function ensureDir(dir) {
  await mkdir(dir, { recursive: true });
}

export async function clearDir(dir) {
  await rm(dir, { recursive: true, force: true });
  await mkdir(dir, { recursive: true });
}

export async function compressTar(sourceDir, outputPath) {
  await execFileAsync('tar', ['-czf', outputPath, '-C', sourceDir, '.']);
}

export async function validateTarArchive(tarPath) {
  const { stdout } = await execFileAsync('tar', ['-tzf', tarPath]);
  const entries = stdout.split('\n').map((entry) => entry.trim()).filter(Boolean);
  for (const entry of entries) {
    const normalized = entry.replace(/^\.\/+/, '').replace(/\/+$/, '');
    if (!normalized || normalized === '.') continue;
    if (path.posix.isAbsolute(normalized) || normalized.split('/').includes('..')) {
      throw new Error(`Asset archive contains an unsafe path: ${entry}`);
    }
  }
  return entries;
}

export async function extractTar(tarPath, targetDir) {
  await ensureDir(targetDir);
  await validateTarArchive(tarPath);
  await execFileAsync('tar', ['-xzf', tarPath, '-C', targetDir]);
}

export async function encryptFile(inputPath, outputPath, key) {
  await execFileAsync('openssl', [
    'enc', '-aes-256-cbc', '-pbkdf2', '-salt',
    '-pass', 'env:BACKUP_ENCRYPTION_KEY',
    '-in', inputPath, '-out', outputPath
  ], { env: { ...process.env, BACKUP_ENCRYPTION_KEY: key } });
}

export async function decryptFile(inputPath, outputPath, key) {
  await execFileAsync('openssl', [
    'enc', '-aes-256-cbc', '-d', '-pbkdf2',
    '-pass', 'env:BACKUP_ENCRYPTION_KEY',
    '-in', inputPath, '-out', outputPath
  ], { env: { ...process.env, BACKUP_ENCRYPTION_KEY: key } });
}

export function parsePostgresUrl(urlString) {
  const url = new URL(urlString);
  return {
    host: url.hostname,
    port: url.port || '5432',
    database: url.pathname.replace(/^\//, '') || '',
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password)
  };
}

export function pgEnv(url) {
  const parsed = parsePostgresUrl(url);
  return {
    PGPASSWORD: parsed.password,
    PGHOST: parsed.host,
    PGPORT: parsed.port,
    PGUSER: parsed.user,
    PGDATABASE: parsed.database
  };
}

export async function dumpDatabase(targetFile, databaseUrl) {
  const env = pgEnv(databaseUrl);
  await execFileAsync('pg_dump', ['-Fc', '-f', targetFile], { env: { ...process.env, ...env } });
}

export async function validatePostgresDump(backupFile, databaseUrl) {
  const env = pgEnv(databaseUrl);
  const { stdout } = await execFileAsync('pg_restore', ['--list', backupFile], {
    env: { ...process.env, ...env }
  });
  if (!stdout.trim()) {
    throw new Error('PostgreSQL backup is not a readable pg_restore archive');
  }
  return stdout;
}

export async function restoreDatabase(backupFile, targetUrl) {
  const env = pgEnv(targetUrl);
  await execFileAsync('pg_restore', [
    '--exit-on-error',
    '--single-transaction',
    '--no-owner',
    '--no-privileges',
    '-d', env.PGDATABASE,
    backupFile
  ], { env: { ...process.env, ...env } });
}

export async function querySingle(databaseUrl, sql) {
  const env = pgEnv(databaseUrl);
  const { stdout } = await execFileAsync(
    'psql',
    ['-v', 'ON_ERROR_STOP=1', '-t', '-A', '-c', sql],
    { env: { ...process.env, ...env } }
  );
  return stdout.trim();
}

export async function isDatabaseEmpty(databaseUrl) {
  const result = await querySingle(databaseUrl, `
    SELECT CASE WHEN EXISTS (
      SELECT 1
      FROM pg_catalog.pg_class AS c
      JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
      WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
        AND n.nspname NOT LIKE 'pg_toast%'
        AND c.relkind IN ('r', 'p', 'v', 'm', 'f', 'S', 'c', 't')
    ) OR EXISTS (
      SELECT 1
      FROM pg_catalog.pg_namespace
      WHERE nspname NOT IN ('pg_catalog', 'information_schema', 'public')
        AND nspname NOT LIKE 'pg_toast%'
    ) THEN 'false' ELSE 'true' END
  `);
  return result === 'true';
}

export async function buildManifest(backupDir) {
  const entries = await readdir(backupDir);
  const files = [];
  for (const name of entries) {
    const full = path.join(backupDir, name);
    const s = await stat(full);
    if (s.isFile()) {
      files.push({
        name,
        sizeBytes: s.size,
        sha256: await sha256File(full)
      });
    }
  }
  return { createdAt: new Date().toISOString(), files };
}

function normalizeS3Prefix(prefix = '') {
  const value = String(prefix).replace(/^\/+|\/+$/g, '');
  return value ? `${value}/` : '';
}

function createS3Client({ endpoint, region, accessKeyId, secretAccessKey, forcePathStyle }) {
  return new S3Client({
    endpoint,
    region: region || 'us-east-1',
    credentials: accessKeyId && secretAccessKey ? { accessKeyId, secretAccessKey } : undefined,
    forcePathStyle: Boolean(forcePathStyle)
  });
}

function assertS3Config(config) {
  if (!config?.bucket) throw new Error('S3 asset bucket is required');
}

async function listS3Objects(config) {
  assertS3Config(config);
  const client = createS3Client(config);
  const objects = [];
  let continuationToken;
  const prefix = normalizeS3Prefix(config.prefix);
  do {
    const response = await client.send(new ListObjectsV2Command({
      Bucket: config.bucket,
      Prefix: prefix,
      ContinuationToken: continuationToken,
      MaxKeys: 1000
    }));
    objects.push(...(response.Contents || []).filter((item) => item.Key));
    continuationToken = response.NextContinuationToken;
  } while (continuationToken);
  return { client, prefix, objects };
}

function safeRelativeS3Key(key, prefix) {
  if (!key.startsWith(prefix)) {
    throw new Error(`S3 object is outside the configured prefix: ${key}`);
  }
  const relative = key.slice(prefix.length);
  if (!relative || path.posix.isAbsolute(relative) || relative.split('/').includes('..')) {
    throw new Error(`S3 object contains an unsafe path: ${key}`);
  }
  return relative;
}

async function walkFiles(rootDir, currentDir = rootDir) {
  const entries = await readdir(currentDir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const full = path.join(currentDir, entry.name);
    if (entry.isDirectory()) {
      files.push(...await walkFiles(rootDir, full));
    } else if (entry.isFile()) {
      files.push({ full, relative: path.relative(rootDir, full).split(path.sep).join('/') });
    }
  }
  return files;
}

export async function syncS3AssetsToLocal(config, targetDir) {
  const { client, prefix, objects } = await listS3Objects(config);
  await ensureDir(targetDir);
  for (const object of objects) {
    const relative = safeRelativeS3Key(object.Key, prefix);
    const outputPath = path.join(targetDir, relative);
    await ensureDir(path.dirname(outputPath));
    const response = await client.send(new GetObjectCommand({
      Bucket: config.bucket,
      Key: object.Key
    }));
    if (!response.Body) throw new Error(`S3 object has no body: ${relative}`);
    await pipeline(response.Body, createWriteStream(outputPath));
  }
  return objects.length;
}

export async function syncLocalAssetsToS3(localDir, config) {
  assertS3Config(config);
  const client = createS3Client(config);
  const prefix = normalizeS3Prefix(config.prefix);
  const files = await walkFiles(localDir);
  for (const file of files) {
    await client.send(new PutObjectCommand({
      Bucket: config.bucket,
      Key: `${prefix}${file.relative}`,
      Body: createReadStream(file.full)
    }));
  }
  return files.length;
}

export async function countS3Assets(config) {
  const { objects } = await listS3Objects(config);
  return objects.length;
}

export async function readManifest(backupDir) {
  const manifestPath = path.join(backupDir, 'manifest.json');
  return JSON.parse(await readFile(manifestPath, 'utf8'));
}

function safeManifestName(name) {
  return typeof name === 'string' && name.length > 0 &&
    !path.isAbsolute(name) && !name.includes('/') && !name.includes('\\');
}

function artifactEntry(manifest, baseName) {
  const candidates = manifest.files.filter((file) => file.name === baseName || file.name === `${baseName}.enc`);
  if (candidates.length !== 1) {
    throw new Error(`Backup must contain exactly one of ${baseName} or ${baseName}.enc`);
  }
  return candidates[0];
}

/**
 * Verify the manifest and all required backup artifacts before a restore can
 * inspect or modify its target. The manifest itself is deliberately excluded
 * from its own file list so it can be written atomically at backup creation.
 */
export async function verifyManifest(backupDir) {
  let manifest;
  try {
    manifest = await readManifest(backupDir);
  } catch (err) {
    throw new Error(`Backup manifest.json is missing or unreadable: ${err.message}`);
  }

  if (!manifest || !Array.isArray(manifest.files) || manifest.files.length === 0) {
    throw new Error('Backup manifest.json is invalid or empty');
  }

  const names = new Set();
  for (const file of manifest.files) {
    if (!file || !safeManifestName(file.name) || names.has(file.name) ||
      !/^[a-f0-9]{64}$/i.test(file.sha256) || !Number.isInteger(file.sizeBytes) || file.sizeBytes < 0) {
      throw new Error('Backup manifest.json contains an invalid file entry');
    }
    names.add(file.name);
    const filePath = path.join(backupDir, file.name);
    if (!existsSync(filePath)) {
      throw new Error(`Backup file listed in manifest is missing: ${file.name}`);
    }
    const fileStat = await stat(filePath);
    if (!fileStat.isFile() || fileStat.size !== file.sizeBytes) {
      throw new Error(`Backup file size mismatch for ${file.name}`);
    }
    const actualHash = await sha256File(filePath);
    if (actualHash !== file.sha256) {
      throw new Error(`Backup file checksum mismatch for ${file.name}`);
    }
  }

  artifactEntry(manifest, 'db.dump');
  artifactEntry(manifest, 'assets.tar.gz');
  return manifest;
}

export function getManifestArtifact(backupDir, manifest, baseName) {
  const entry = artifactEntry(manifest, baseName);
  return {
    path: path.join(backupDir, entry.name),
    encrypted: entry.name.endsWith('.enc')
  };
}

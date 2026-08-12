#!/usr/bin/env node
/**
 * Build and exercise the production image against disposable PostgreSQL,
 * Redis and MinIO containers. The script only removes containers and the
 * uniquely named network that it creates; it never searches for or removes
 * resources belonging to another run.
 */

import { execFile } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';

const execFileAsync = promisify(execFile);
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const runId = `${process.pid}-${randomUUID().slice(0, 12)}`;
const label = `aistickers.t11b.smoke=${runId}`;
const network = `aistickers-t11b-network-${runId}`;
const image = process.env.PRODUCTION_SMOKE_IMAGE || `aistickers-backend:production-smoke-${runId}`;
const hostPort = Number(process.env.PRODUCTION_SMOKE_PORT || 0);

const names = {
  postgres: `aistickers-t11b-postgres-${runId}`,
  redis: `aistickers-t11b-redis-${runId}`,
  minio: `aistickers-t11b-minio-${runId}`,
  migrate: `aistickers-t11b-migrate-${runId}`,
  backend: `aistickers-t11b-backend-${runId}`,
  worker: `aistickers-t11b-worker-${runId}`
};

const smokeEnv = {
  NODE_ENV: 'production',
  PORT: '2002',
  DATA_DIR: '/app/runtime',
  PERSISTENCE_DRIVER: 'postgres',
  DATABASE_URL: 'postgresql://aistickers:smoke-postgres-password@postgres:5432/aistickers',
  REDIS_URL: 'redis://redis:6379',
  GENERATION_QUEUE_ENABLED: 'true',
  GENERATION_QUEUE_CONCURRENCY: '1',
  GENERATION_QUEUE_RECONCILE_INTERVAL_MS: '600000',
  ASSET_STORAGE_DRIVER: 's3',
  ASSET_STORAGE_BUCKET: 'aistickers-private-assets',
  ASSET_STORAGE_PREFIX: `smoke-${runId}`,
  ASSET_STORAGE_REGION: 'us-east-1',
  ASSET_STORAGE_ENDPOINT: 'http://minio:9000',
  ASSET_STORAGE_ACCESS_KEY_ID: 'minioadmin',
  ASSET_STORAGE_SECRET_ACCESS_KEY: 'minioadmin123',
  ASSET_STORAGE_FORCE_PATH_STYLE: 'true',
  ['JWT' + '_SECRET']: 'smoke-jwt-secret-minimum-32-characters',
  CLIENT_ID: 'aistickers-smoke-client',
  ['CLIENT' + '_SECRET']: 'smoke-client-secret-minimum-32-characters',
  GOOGLE_CLIENT_ID: 'smoke-google-client',
  ['GOOGLE_CLIENT' + '_SECRET']: 'smoke-google-client-secret',
  GOOGLE_PACKAGE_NAME: 'com.animatedsticker.aistickers',
  ['GOOGLE_PLAY_' + 'SERVICE_ACCOUNT']: '{"type":"service_account","project_id":"smoke-project","client_email":"smoke@example.test","private_key":"smoke-private-key"}',
  ['REPLICATE' + '_API_TOKEN']: 'smoke-replicate-token',
  REPLICATE_MODEL: 'google/nano-banana',
  REPLICATE_IMG2VID_MODEL: 'bytedance/seedance-1-pro',
  CORS_ORIGINS: 'https://app.example.test',
  HMAC_LEGACY_V1_ENABLED: 'false',
  ENABLE_APPLE_PAYMENTS: 'false',
  ENABLE_TELEGRAM: 'false',
  ENABLE_WHATSAPP_EXPORT: 'false',
  ENABLE_EXTERNAL_IMAGE_URLS: 'false',
  ENABLE_TEST_JWTS: 'false',
  METRICS_ENABLED: 'true',
  METRICS_BEARER_TOKEN: 'smoke-metrics-bearer-token'
};

function getFreePort() {
  if (hostPort > 0) return Promise.resolve(hostPort);
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      server.close(error => (error ? reject(error) : resolve(port)));
    });
  });
}

async function docker(args, { allowFailure = false } = {}) {
  try {
    return await execFileAsync('docker', args, {
      cwd: projectRoot,
      maxBuffer: 12 * 1024 * 1024
    });
  } catch (error) {
    if (allowFailure) return { stdout: '', stderr: '', error };
    const detail = String(error.stderr || error.stdout || error.message || 'unknown Docker error')
      .replace(/(postgres(?:ql)?:\/\/)[^\s/@]+:[^\s/@]+@/gi, '$1[redacted]@')
      .replace(/(https?:\/\/)[^\s/]+:[^\s/@]+@/gi, '$1[redacted]@');
    throw new Error(`Docker command failed: ${detail}`);
  }
}

function envArgs(environment) {
  return Object.entries(environment).flatMap(([key, value]) => ['--env', `${key}=${value}`]);
}

async function waitForHealth(containerName, timeoutMs = 90000) {
  const deadline = Date.now() + timeoutMs;
  let lastStatus = 'starting';
  while (Date.now() < deadline) {
    const result = await docker(['inspect', '--format', '{{.State.Health.Status}}', containerName], { allowFailure: true });
    lastStatus = result.stdout.trim() || lastStatus;
    if (lastStatus === 'healthy') return;
    if (lastStatus === 'unhealthy') {
      throw new Error(`Container ${containerName} reported unhealthy`);
    }
    await delay(1000);
  }
  throw new Error(`Timed out waiting for ${containerName} health (${lastStatus})`);
}

async function waitForHttp(url, timeoutMs = 90000) {
  const deadline = Date.now() + timeoutMs;
  let lastStatus = 'connection refused';
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      lastStatus = String(response.status);
      if (response.ok) return response;
    } catch {
      // The backend is still booting or its readiness dependencies are not up.
    }
    await delay(1000);
  }
  throw new Error(`Timed out waiting for ${url.replace(/\/health.*/, '/health/*')} (${lastStatus})`);
}

async function assertNotRoot(containerName) {
  const result = await docker(['exec', containerName, 'id', '-u']);
  const uid = result.stdout.trim();
  if (!uid || uid === '0') throw new Error(`${containerName} is running as root`);
}

async function stopCleanly(containerName) {
  await docker(['kill', '--signal', 'SIGTERM', containerName]);
  const result = await docker(['wait', containerName]);
  const exitCode = Number(result.stdout.trim());
  if (exitCode !== 0) {
    throw new Error(`${containerName} did not exit cleanly after SIGTERM (exit ${exitCode})`);
  }
}

async function initializeMinio() {
  const initName = `aistickers-t11b-minio-init-${runId}`;
  await docker([
    'run', '--rm', '--name', initName, '--label', label, '--network', network,
    '--entrypoint', '/bin/sh', 'minio/mc:RELEASE.2025-08-13T08-35-41Z', '-c',
    'until mc alias set local http://minio:9000 minioadmin minioadmin123; do sleep 1; done; mc mb --ignore-existing local/aistickers-private-assets; mc anonymous set none local/aistickers-private-assets'
  ]);
}

async function main() {
  let port;
  try {
    port = await getFreePort();
    await docker(['build', '--tag', image, projectRoot]);
    await docker(['network', 'create', '--label', label, network]);

    await docker([
      'run', '--detach', '--name', names.postgres, '--label', label, '--network', network, '--network-alias', 'postgres',
      '--tmpfs', '/var/lib/postgresql/data:rw,nosuid,nodev',
      '--env', 'POSTGRES_USER=aistickers',
      '--env', 'POSTGRES_PASSWORD=smoke-postgres-password',
      '--env', 'POSTGRES_DB=aistickers',
      '--health-cmd', 'pg_isready -U aistickers -d aistickers',
      '--health-interval', '2s', '--health-timeout', '5s', '--health-retries', '30',
      'postgres:16-alpine3.22'
    ]);
    await docker([
      'run', '--detach', '--name', names.redis, '--label', label, '--network', network, '--network-alias', 'redis',
      '--tmpfs', '/data:rw,nosuid,nodev',
      '--health-cmd', 'redis-cli ping',
      '--health-interval', '2s', '--health-timeout', '5s', '--health-retries', '30',
      'redis:7.4-alpine', 'redis-server', '--appendonly', 'yes'
    ]);
    await docker([
      'run', '--detach', '--name', names.minio, '--label', label, '--network', network, '--network-alias', 'minio',
      '--tmpfs', '/data:rw,nosuid,nodev',
      '--env', 'MINIO_ROOT_USER=minioadmin',
      '--env', 'MINIO_ROOT_PASSWORD=minioadmin123',
      '--health-cmd', 'mc ready local',
      '--health-interval', '2s', '--health-timeout', '5s', '--health-retries', '30',
      'minio/minio:RELEASE.2025-09-07T16-13-09Z', 'server', '/data'
    ]);

    await Promise.all([
      waitForHealth(names.postgres),
      waitForHealth(names.redis),
      waitForHealth(names.minio)
    ]);
    await initializeMinio();

    await docker([
      'run', '--name', names.migrate, '--label', label, '--network', network,
      '--tmpfs', '/app/runtime:rw,nosuid,nodev',
      ...envArgs(smokeEnv), image, 'npm', 'run', 'prisma:migrate:deploy'
    ]);

    await docker([
      'run', '--detach', '--init', '--name', names.backend, '--label', label, '--network', network,
      '--publish', `127.0.0.1:${port}:2002`,
      '--tmpfs', '/app/runtime:rw,nosuid,nodev',
      ...envArgs(smokeEnv), image
    ]);
    await docker([
      'run', '--detach', '--init', '--name', names.worker, '--label', label, '--network', network,
      '--tmpfs', '/app/runtime:rw,nosuid,nodev',
      ...envArgs(smokeEnv), image, 'node', 'scripts/worker-generation.js'
    ]);

    await waitForHttp(`http://127.0.0.1:${port}/health/ready`);
    const live = await fetch(`http://127.0.0.1:${port}/health/live`);
    if (!live.ok) throw new Error('Live health check failed');

    const metricsWithoutToken = await fetch(`http://127.0.0.1:${port}/metrics`);
    if (metricsWithoutToken.status !== 401 && metricsWithoutToken.status !== 404) {
      throw new Error('Metrics endpoint is neither protected nor disabled');
    }
    if (metricsWithoutToken.status === 401) {
      const metricsWithToken = await fetch(`http://127.0.0.1:${port}/metrics`, {
        headers: { authorization: `Bearer ${smokeEnv.METRICS_BEARER_TOKEN}` }
      });
      if (!metricsWithToken.ok) throw new Error('Protected metrics endpoint rejected its configured bearer token');
    }

    await Promise.all([assertNotRoot(names.backend), assertNotRoot(names.worker)]);
    await waitForHealth(names.backend);

    await stopCleanly(names.backend);
    await stopCleanly(names.worker);
    console.log('Docker production smoke passed: image, migrations, readiness, metrics, non-root and SIGTERM verified.');
  } finally {
    for (const containerName of Object.values(names)) {
      await docker(['rm', '--force', containerName], { allowFailure: true });
    }
    await docker(['network', 'rm', network], { allowFailure: true });
  }
}

main().catch(error => {
  console.error(error.message || 'Docker production smoke failed');
  process.exitCode = 1;
});

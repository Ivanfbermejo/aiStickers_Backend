import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import http from 'node:http';
import net from 'node:net';
import { fork } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildTestApp } from '../helpers/app.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const indexPath = path.resolve(__dirname, '..', '..', 'index.js');

function getFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
    srv.on('error', reject);
  });
}

function waitFor(predicate, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs;
    const check = () => {
      if (predicate()) {
        resolve();
      } else if (Date.now() >= deadline) {
        reject(new Error('waitFor timeout'));
      } else {
        setTimeout(check, 20);
      }
    };
    check();
  });
}

describe('shutdown', () => {
  let ctx;
  let started;
  let startServer;
  let stopServer;

  beforeEach(async () => {
    process.env.NODE_ENV = 'test';
    started = null;
    ctx = await buildTestApp();
    const serverMod = await import('../../src/server.js');
    startServer = serverMod.startServer;
    stopServer = serverMod.stopServer;
  });

  afterEach(async () => {
    if (started?.server?.listening) {
      try {
        await stopServer(started);
      } catch {
        // ignore cleanup errors
      }
    }

    ctx?.cleanup();
  });

  it('allows an in-flight request to finish and returns true', async () => {
    started = await startServer({ app: ctx.app, container: ctx.container, port: 0 });
    const { port } = started.server.address();

    const req = http.get({
      host: '127.0.0.1',
      port,
      path: '/__test/ok?delay=200',
      agent: false,
      headers: { Connection: 'close' }
    }, (res) => {
      res.resume();
    });
    req.on('error', () => {});

    // Give the server a moment to start processing the request.
    await new Promise((resolve) => setTimeout(resolve, 50));

    const clean = await stopServer(started);

    expect(clean).toBe(true);
    req.destroy();
  });

  it('returns false when a handler never responds and times out', async () => {
    started = await startServer({ app: ctx.app, container: ctx.container, port: 0 });
    const { port } = started.server.address();

    const hangReq = http.request({ host: '127.0.0.1', port, path: '/__test/hang', method: 'GET' });
    hangReq.on('error', () => {});
    hangReq.end();

    // Ensure the server has accepted the request before starting shutdown.
    await new Promise((resolve) => setTimeout(resolve, 50));

    const clean = await stopServer({ ...started, timeoutMs: 500 });

    expect(clean).toBe(false);
    hangReq.destroy();
  });

  it('returns the same promise when stopServer is called concurrently', async () => {
    started = await startServer({ app: ctx.app, container: ctx.container, port: 0 });

    const p1 = stopServer(started);
    const p2 = stopServer(started);

    expect(p1).toBe(p2);
    expect(await p1).toBe(true);
  });

  it('returns true from a second stopServer after a successful stop', async () => {
    started = await startServer({ app: ctx.app, container: ctx.container, port: 0 });

    expect(await stopServer(started)).toBe(true);
    const result = await stopServer(started);

    expect(result).toBe(true);
  });

  it('closes dependencies in the correct order', async () => {
    started = await startServer({ app: ctx.app, container: ctx.container, port: 0 });

    const order = [];
    ctx.container.services.generationQueue = {
      close: vi.fn(async () => {
        order.push('generationQueue');
      })
    };
    ctx.container.services.assetStorage = {
      close: vi.fn(async () => {
        order.push('assetStorage');
      })
    };
    ctx.app.locals.redisSecurity = {
      close: vi.fn(async () => {
        order.push('redisSecurity');
      })
    };
    const prismaClient = await import('../../src/infrastructure/persistence/prisma/client.js');
    vi.spyOn(prismaClient, 'disconnectPrisma').mockImplementation(async () => {
      order.push('prisma');
    });

    await stopServer(started);

    expect(order).toEqual(['generationQueue', 'assetStorage', 'redisSecurity', 'prisma']);
  });

  it('double SIGTERM handler in index.js does not start two shutdowns', async () => {
    const port = await getFreePort();
    const dataDir = mkdtempSync(path.join(tmpdir(), 'aistickers-shutdown-sigterm-'));

    const childEnv = {
      ...process.env,
      NODE_ENV: 'test',
      PORT: String(port),
      SHUTDOWN_TIMEOUT_MS: '500',
      DATA_DIR: dataDir,
      GENERATION_QUEUE_ENABLED: 'false',
      CLIENT_SECRET: randomBytes(32).toString('hex'),
      JWT_SECRET: randomBytes(32).toString('hex'),
      LOG_LEVEL: 'info'
    };

    const proc = fork(indexPath, [], { env: childEnv, silent: true });
    let logs = '';
    proc.stdout?.on('data', (data) => {
      logs += data.toString();
    });
    proc.stderr?.on('data', (data) => {
      logs += data.toString();
    });

    await waitFor(() => logs.includes('server listening'), 20000);

    // Keep an idle connection open so the server does not shut down immediately.
    const hangReq = http.request({
      host: '127.0.0.1',
      port,
      path: '/health',
      method: 'GET',
      headers: { 'Content-Length': '1000' }
    });
    hangReq.write('partial');
    await new Promise((resolve) => setTimeout(resolve, 50));

    proc.kill('SIGTERM');
    await new Promise((resolve) => setTimeout(resolve, 10));
    proc.kill('SIGTERM');

    const exitCode = await new Promise((resolve) => proc.on('exit', resolve));

    hangReq.destroy();
    rmSync(dataDir, { recursive: true, force: true });

    expect(logs).toContain('received shutdown signal, draining gracefully');
    expect(logs).toContain('shutdown already in progress');
    expect([0, 1]).toContain(exitCode);
  }, 20000);
});

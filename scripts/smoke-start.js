import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout } from 'node:timers/promises';

const PORT = process.env.PORT || 2002;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const DATA_DIR = mkdtempSync(join(tmpdir(), 'aistickers-smoke-'));

const child = spawn('node', ['index.js'], {
  stdio: 'pipe',
  env: {
    ...process.env,
    PORT,
    DATA_DIR,
    TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN ?? 'smoke-test-token',
    NODE_ENV: 'test'
  }
});

let output = '';
child.stdout.on('data', chunk => { output += chunk; });
child.stderr.on('data', chunk => { output += chunk; });

const start = Date.now();
let healthy = false;
let lastStatus = null;

while (Date.now() - start < 20000) {
  await setTimeout(400);
  try {
    const res = await fetch(`${BASE_URL}/health`);
    lastStatus = res.status;
    if (res.ok) {
      healthy = true;
      break;
    }
  } catch {
    // Server not ready yet
  }
}

child.kill('SIGTERM');
await setTimeout(1000);
if (!child.killed) {
  child.kill('SIGKILL');
}

if (!healthy) {
  console.error('Smoke start failed: server did not become healthy.');
  console.error(`Last status: ${lastStatus}`);
  console.error(output);
  rmSync(DATA_DIR, { recursive: true, force: true });
  process.exit(1);
}

rmSync(DATA_DIR, { recursive: true, force: true });
console.log(`Smoke start passed: health endpoint OK on port ${PORT}.`);

import { spawn } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';
import { setTimeout } from 'node:timers/promises';

const PORT = process.env.PORT || 22024;
const DATA_DIR = process.env.DATA_DIR || './tmp-data';
const BASE_URL = `http://127.0.0.1:${PORT}`;

if (existsSync(DATA_DIR)) {
  rmSync(DATA_DIR, { recursive: true, force: true });
}

const child = spawn('node', ['index.js'], {
  stdio: 'pipe',
  env: process.env
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
  process.exit(1);
}

console.log(`Smoke start passed: health endpoint OK on port ${PORT}.`);

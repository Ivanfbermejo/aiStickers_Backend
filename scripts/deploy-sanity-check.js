import { readFileSync, readdirSync, statSync, existsSync, rmSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { setTimeout } from 'node:timers/promises';

const PORT = process.env.PORT || 34567;
const DATA_DIR = process.env.DATA_DIR || './tmp-data';
const BASE_URL = `http://127.0.0.1:${PORT}`;

const pkg = JSON.parse(readFileSync('package.json', 'utf8'));

if (!pkg.scripts || !pkg.scripts.start) {
  console.error('Deploy sanity failed: package.json is missing a "start" script.');
  process.exit(1);
}

if (existsSync(DATA_DIR)) {
  rmSync(DATA_DIR, { recursive: true, force: true });
}

const beforeDirs = new Set(readdirSync('.').filter(entry => statSync(entry).isDirectory()));

const child = spawn('node', ['index.js'], {
  stdio: 'pipe',
  env: process.env
});

let output = '';
child.stdout.on('data', chunk => { output += chunk; });
child.stderr.on('data', chunk => { output += chunk; });

const start = Date.now();
let healthy = false;

while (Date.now() - start < 20000) {
  await setTimeout(400);
  try {
    const res = await fetch(`${BASE_URL}/health`);
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
  console.error('Deploy sanity failed: server did not become healthy.');
  console.error(`Expected port: ${PORT}`);
  console.error(output);
  process.exit(1);
}

const afterDirs = readdirSync('.').filter(entry => statSync(entry).isDirectory());
const newDirs = afterDirs.filter(dir => !beforeDirs.has(dir));
const dataDirName = DATA_DIR.replace(/^\.\//, '');
const disallowed = newDirs.filter(dir => dir !== dataDirName);

if (disallowed.length > 0) {
  console.error('Deploy sanity failed: server wrote outside DATA_DIR.');
  console.error(`New disallowed root directories: ${disallowed.join(', ')}`);
  process.exit(1);
}

console.log('Deploy sanity check passed.');
console.log(`Server responded on configured port ${PORT} and wrote only under ${DATA_DIR}.`);

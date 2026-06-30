import { readFileSync, readdirSync, statSync } from 'node:fs';
import { extname, join } from 'node:path';

const SECRET_VARS = [
  'JWT_SECRET',
  'CLIENT_SECRET',
  'REPLICATE_API_TOKEN',
  'GOOGLE_CLIENT_SECRET',
  'TELEGRAM_BOT_TOKEN',
  'POEDITOR_API_TOKEN',
  'GOOGLE_PLAY_SERVICE_ACCOUNT'
];

const INSECURE_FALLBACK_RE = new RegExp(
  `\\b(${SECRET_VARS.join('|')})\\s*\\|\\|\\s*['"\`]`,
  'g'
);

const HARDCODED_SECRET_RE = new RegExp(
  `\\b(${SECRET_VARS.join('|')})\\s*[:=]\\s*['"\`][^'"\`]{3,}['"\`]`,
  'g'
);

const PRIVATE_KEY_RE = /-----BEGIN (RSA |DSA |EC |OPENSSH )?PRIVATE KEY-----/;

const SKIP_DIRS = ['node_modules', '.git', '.github', 'tmp-data'];
const SKIP_FILES = ['security-scan.js'];

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.includes(entry)) continue;

    const full = join(dir, entry);
    const stats = statSync(full);

    if (stats.isDirectory()) {
      yield* walk(full);
    } else if (stats.isFile() && extname(full) === '.js') {
      yield full;
    }
  }
}

let found = 0;

for (const file of walk('.')) {
  if (SKIP_FILES.some(skip => file.endsWith(skip))) continue;

  const content = readFileSync(file, 'utf8');
  const lines = content.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    if (trimmed.startsWith('//')) continue;

    if (INSECURE_FALLBACK_RE.test(line)) {
      console.error(`[INSECURE FALLBACK] ${file}:${i + 1}: ${trimmed}`);
      found++;
    }

    if (HARDCODED_SECRET_RE.test(line)) {
      // Allow assignments that read from process.env, e.g. VAR: process.env.VAR
      if (!line.includes('process.env')) {
        console.error(`[HARDCODED SECRET] ${file}:${i + 1}: ${trimmed}`);
        found++;
      }
    }

    if (PRIVATE_KEY_RE.test(line)) {
      console.error(`[PRIVATE KEY] ${file}:${i + 1}`);
      found++;
    }
  }
}

if (found > 0) {
  console.error(`\n${found} security issue(s) found.`);
  process.exit(1);
}

console.log('Security scan passed.');

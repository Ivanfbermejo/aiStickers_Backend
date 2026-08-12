import { readFileSync } from 'node:fs';

const source = readFileSync('src/server.js', 'utf8');
const APP_ROUTE_RE = /\bapp\.(get|post|put|delete|patch)\s*\(/g;

function scanDelimited(input, start, onSeparator) {
  const stack = ['('];
  let quote = null;
  let escaped = false;
  let comment = null;

  for (let index = start; index < input.length; index += 1) {
    const char = input[index];
    const next = input[index + 1];

    if (comment === 'line') {
      if (char === '\n') comment = null;
      continue;
    }
    if (comment === 'block') {
      if (char === '*' && next === '/') {
        comment = null;
        index += 1;
      }
      continue;
    }
    if (quote) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === quote) quote = null;
      continue;
    }
    if (char === '/' && next === '/') {
      comment = 'line';
      index += 1;
      continue;
    }
    if (char === '/' && next === '*') {
      comment = 'block';
      index += 1;
      continue;
    }
    if (char === "'" || char === '"' || char === '`') {
      quote = char;
      continue;
    }
    if (char === '(' || char === '[' || char === '{') stack.push(char);
    else if (char === ')' || char === ']' || char === '}') {
      stack.pop();
      if (stack.length === 0) return index;
    } else if (char === ',' && stack.length === 1) {
      onSeparator(index);
    }
  }
  return -1;
}

function parseRoutes(input) {
  const parsed = [];
  let match;
  while ((match = APP_ROUTE_RE.exec(input)) !== null) {
    const argsStart = APP_ROUTE_RE.lastIndex;
    const separators = [];
    const end = scanDelimited(input, argsStart, index => separators.push(index));
    if (end < 0) continue;

    const boundaries = [argsStart - 1, ...separators, end];
    const args = boundaries.slice(0, -1).map((boundary, index) =>
      input.slice(boundary + 1, boundaries[index + 1]).trim()
    );
    const pathMatch = args[0]?.match(/^(['"])(.*?)\1$/s);
    if (!pathMatch) continue;

    const middleware = args.slice(1).flatMap(arg => {
      const identifier = arg.match(/^([a-zA-Z_$][a-zA-Z0-9_$]*)$/);
      if (identifier) return [identifier[1]];
      const factory = arg.match(/^([a-zA-Z_$][a-zA-Z0-9_$]*)\s*\(/);
      return factory ? [factory[1]] : [];
    });
    const line = input.slice(0, match.index).split('\n').length;
    parsed.push({ method: match[1], path: pathMatch[2], middleware, line });
    APP_ROUTE_RE.lastIndex = end + 1;
  }
  return parsed;
}

const routes = parseRoutes(source);

// Required public/private endpoints currently used by Android clients.
const REQUIRED = [
  { method: 'post', path: '/api/v1/auth/token', middleware: ['requireHmac'] },
  { method: 'post', path: '/api/v1/auth/google', middleware: ['requireHmac'] },
  { method: 'get', path: '/api/v1/auth/me', middleware: ['requireHmac', 'requireAuth'] },
  { method: 'post', path: '/api/v1/auth/refresh', middleware: ['requireHmac'] },
  { method: 'get', path: '/api/v1/config', middleware: ['requireHmac'] },
  { method: 'get', path: '/api/v1/styles', middleware: ['requireHmac'] },
  { method: 'get', path: '/api/v1/plans', middleware: ['requireHmac', 'requireAuth'] },
  { method: 'get', path: '/api/v1/users/balance', middleware: ['requireHmac', 'requireUser'] },
  { method: 'get', path: '/api/v1/users/me/assets', middleware: ['requireHmac', 'requireUser'] },
  { method: 'post', path: '/api/v1/ai/process-image', middleware: ['requireHmac', 'requireUser'] },
  { method: 'post', path: '/api/v1/ai/img2vid', middleware: ['requireHmac', 'requireUser'] },
  { method: 'get', path: '/api/v1/ai/status/:predictionId', middleware: ['requireHmac', 'requireUser'] },
  { method: 'get', path: '/api/v1/stickers', middleware: ['requireHmac', 'requireUser'] },
  { method: 'post', path: '/api/v1/stickers', middleware: ['requireHmac', 'requireUser'] },
  { method: 'get', path: '/api/v1/packages', middleware: ['requireHmac', 'requireUser'] },
  { method: 'post', path: '/api/v1/packages', middleware: ['requireHmac', 'requireUser'] }
];

// Costly and high-frequency routes must retain their configured limiter.
const RATE_LIMITED = [
  { method: 'post', path: '/api/v1/auth/token', middleware: 'rateLimitIp' },
  { method: 'post', path: '/api/v1/auth/google', middleware: 'rateLimitIp' },
  { method: 'post', path: '/api/v1/payments/validate/google-play', middleware: 'rateLimitUser' },
  { method: 'post', path: '/api/v1/payments/validate/apple-app-store', middleware: 'rateLimitUser' },
  { method: 'post', path: '/api/v1/ai/process-image', middleware: 'generationRateLimit' },
  { method: 'post', path: '/api/v1/ai/process-image', middleware: 'uploadRateLimit' },
  { method: 'post', path: '/api/v1/ai/process-image', middleware: 'activeGenerationLimit' },
  { method: 'post', path: '/api/v1/ai/img2vid', middleware: 'generationRateLimit' },
  { method: 'post', path: '/api/v1/ai/img2vid', middleware: 'activeGenerationLimit' },
  { method: 'get', path: '/api/v1/ai/status/:predictionId', middleware: 'statusRateLimit' },
  { method: 'post', path: '/api/v1/generation', middleware: 'generationRateLimit' },
  { method: 'post', path: '/api/v1/generation', middleware: 'activeGenerationLimit' },
  { method: 'get', path: '/api/v1/generation', middleware: 'statusRateLimit' },
  { method: 'get', path: '/api/v1/generation/:jobId', middleware: 'statusRateLimit' },
  { method: 'post', path: '/api/v1/stickers', middleware: 'uploadRateLimit' },
  { method: 'post', path: '/api/v1/telegram/export-pack', middleware: 'exportRateLimit' },
  { method: 'post', path: '/api/v1/telegram/reconcile-pack', middleware: 'exportRateLimit' },
  { method: 'get', path: '/api/v1/telegram/pack-status/:setName', middleware: 'statusRateLimit' },
  { method: 'post', path: '/api/v1/stickers/:id/export/whatsapp', middleware: 'exportRateLimit' },
  { method: 'get', path: '/api/v1/stickers/:id/export/whatsapp', middleware: 'statusRateLimit' },
  { method: 'post', path: '/api/v1/packages/:id/export/whatsapp', middleware: 'exportRateLimit' },
  { method: 'get', path: '/api/v1/packages/:id/export/whatsapp', middleware: 'statusRateLimit' }
];

// New private endpoints must be guarded with both HMAC and user JWT.
const PRIVATE_NEW_PATTERNS = [
  /^\/api\/v1\/generation/,
  /^\/api\/v1\/stickers\/[^/]+\/export\/whatsapp/,
  /^\/api\/v1\/packages\/[^/]+\/export\/whatsapp/
];

let errors = 0;

for (const req of REQUIRED) {
  const route = routes.find(r => r.method === req.method && r.path === req.path);

  if (!route) {
    console.error(`Missing required route: ${req.method.toUpperCase()} ${req.path}`);
    errors++;
    continue;
  }

  for (const mw of req.middleware) {
    if (!route.middleware.includes(mw)) {
      console.error(
        `Route ${req.method.toUpperCase()} ${req.path} missing middleware ${mw} (line ${route.line})`
      );
      errors++;
    }
  }
}

for (const req of RATE_LIMITED) {
  const route = routes.find(r => r.method === req.method && r.path === req.path);
  if (!route) {
    console.error(`Missing rate-limited route: ${req.method.toUpperCase()} ${req.path}`);
    errors++;
  } else if (!route.middleware.includes(req.middleware)) {
    console.error(
      `Route ${req.method.toUpperCase()} ${req.path} missing limiter ${req.middleware} (line ${route.line})`
    );
    errors++;
  }
}

for (const route of routes) {
  if (PRIVATE_NEW_PATTERNS.some(re => re.test(route.path))) {
    if (!route.middleware.includes('requireHmac')) {
      console.error(
        `New private route ${route.method.toUpperCase()} ${route.path} must use requireHmac (line ${route.line})`
      );
      errors++;
    }
    if (!route.middleware.includes('requireUser')) {
      console.error(
        `New private route ${route.method.toUpperCase()} ${route.path} must use requireUser (line ${route.line})`
      );
      errors++;
    }
  }
}

if (errors > 0) {
  console.error(`\n${errors} API contract violation(s) found.`);
  process.exit(1);
}

console.log('API contract check passed.');

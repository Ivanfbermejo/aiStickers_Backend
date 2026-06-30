import { readFileSync } from 'node:fs';

const source = readFileSync('index.js', 'utf8');

// Each route definition is expected to be a single line.
const ROUTE_RE = /\bapp\.(get|post|put|delete|patch)\s*\(\s*['"]([^'"]+)['"]\s*,(.*)\)\s*;?$/gm;

const routes = [];
let match;

while ((match = ROUTE_RE.exec(source)) !== null) {
  const [, method, path, rest] = match;
  const args = rest
    .split(',')
    .map(arg => arg.trim())
    .filter(Boolean);

  // Middleware entries are simple identifiers (e.g. requireHmac, requireUser).
  // Handler calls like Controller.action or upload.single(...) are ignored.
  const middleware = args.filter(arg => /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(arg));
  const line = source.slice(0, match.index).split('\n').length;

  routes.push({ method, path, middleware, line });
}

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

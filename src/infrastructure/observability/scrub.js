import { env } from '../../config/env.js';

export const CENSOR = '[REDACTED]';

const SENSITIVE_KEYS = new Set([
  'authorization',
  'cookie',
  'set-cookie',
  'x-api-key',
  'apikey',
  'api_key',
  'api-key',
  'hmac',
  'x-app-signature',
  'x-integrity-token',
  'idtoken',
  'id_token',
  'idToken',
  'accesstoken',
  'access_token',
  'accessToken',
  'refreshtoken',
  'refresh_token',
  'refreshToken',
  'purchasetoken',
  'purchase_token',
  'purchaseToken',
  'receipt',
  'email',
  'prompt',
  'password',
  'secret',
  'client_secret',
  'clientsecret',
  'signature',
  'x-amz-signature',
  'token',
  'jwt',
  'googletoken',
  'integritytoken',
  'apitoken',
  'objectkey',
  'signedurl',
  'signed_url'
]);

const BASE64_RE = /^(?:[A-Za-z0-9+/]{4})+(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=|[A-Za-z0-9+/]{4})$/;
const DATA_URI_RE = /^data:([a-zA-Z0-9+.-]+\/[a-zA-Z0-9+.-]+)?;base64,.+$/;
const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
const SENTRY_DSN_RE = /https?:\/\/[^\s/@]+@[^\s/]+\/\d+(?:\/)?/gi;
const SENSITIVE_QUERY_RE = /^(signature|sig|token|access[_-]?token|refresh[_-]?token|id[_-]?token|purchase[_-]?token|receipt|api[_-]?key|x-amz-(?:signature|credential|date|expires|signedheaders)|authorization|hmac|idToken|accessToken|refreshToken|purchaseToken|policy|key-pair-id)$/i;

// Redact Authorization / Bearer headers while keeping the label.
const AUTH_HEADER_RE = /(\bAuthorization:\s*)(Bearer\s+)?([A-Za-z0-9_\-.~+/]+=*)/gi;
const BEARER_RE = /(\bBearer\s+)([A-Za-z0-9_\-.~+/]+=*)/g;
const FULL_JWT_RE = /\beyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g;
const JWT_SEGMENT_RE = /\beyJ[A-Za-z0-9_-]+\b/g;

function looksLikeSensitiveKey(key) {
  if (typeof key !== 'string' && typeof key !== 'number') return false;
  const lower = String(key).toLowerCase();
  if (SENSITIVE_KEYS.has(lower)) return true;
  if (lower.includes('token') || lower.includes('secret') || lower.includes('password') || lower.includes('signature') || lower.includes('hmac') || lower.includes('receipt') || lower.includes('apikey')) return true;
  return false;
}

function redactString(value) {
  if (typeof value !== 'string') return value;
  if (value === CENSOR) return value;

  let out = value;

  // Sentry DSNs are configuration secrets and must not appear in errors,
  // structured context, or log messages.
  out = out.replace(SENTRY_DSN_RE, CENSOR);

  // Redact Authorization headers and Bearer tokens, keeping the label.
  out = out.replace(AUTH_HEADER_RE, (match, label, bearer, token) => {
    if (!token) return match;
    return `${label}${bearer || ''}${CENSOR}`;
  });
  out = out.replace(BEARER_RE, (match, label, token) => {
    if (!token) return match;
    return `${label}${CENSOR}`;
  });

  // Redact JWT-looking / eyJ... segments.
  out = out.replace(FULL_JWT_RE, CENSOR);
  out = out.replace(JWT_SEGMENT_RE, CENSOR);

  // Emails anywhere in a string
  out = out.replace(EMAIL_RE, CENSOR);

  // Signed URLs / query strings: if any query param looks sensitive, redact the whole URL.
  try {
    const url = new URL(out);
    for (const key of url.searchParams.keys()) {
      if (SENSITIVE_QUERY_RE.test(key)) {
        return CENSOR;
      }
    }
  } catch {
    // Not a URL — nothing to do.
  }

  // Long base64 / data URIs
  if (out.length > 40 && BASE64_RE.test(out)) return CENSOR;
  if (DATA_URI_RE.test(out)) return out.replace(DATA_URI_RE, (match, type) => `data:${type || ''};base64,${CENSOR}`);

  return out;
}

export function scrub(value, options = {}) {
  const seen = options.seen || new WeakSet();
  const redactStack = options.redactStack ?? env.NODE_ENV === 'production';

  if (value === null || value === undefined) return value;
  if (typeof value === 'string') return redactString(value);
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'bigint') return String(value);
  if (typeof value === 'function') return CENSOR;
  if (typeof value === 'symbol') return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (value instanceof RegExp) return CENSOR;
  if (value instanceof Error) {
    const out = {
      type: value.constructor?.name || 'Error',
      message: redactString(value.message),
      code: value.code
    };
    if (!redactStack && value.stack) {
      out.stack = value.stack;
    }
    return out;
  }
  if (Array.isArray(value)) {
    return value.map((item) => scrub(item, { seen, redactStack }));
  }
  if (typeof value === 'object') {
    if (seen.has(value)) return '[Circular]';
    seen.add(value);
    const out = {};
    for (const [key, v] of Object.entries(value)) {
      if (looksLikeSensitiveKey(key)) {
        out[key] = CENSOR;
      } else if (typeof v === 'string' && looksLikeSensitiveKey(key)) {
        out[key] = CENSOR;
      } else {
        out[key] = scrub(v, { seen, redactStack });
      }
    }
    seen.delete(value);
    return out;
  }
  return CENSOR;
}

export function scrubString(value) {
  return redactString(value);
}

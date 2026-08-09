import crypto from 'node:crypto';
import { env } from '../../../config/env.js';

const HMAC_V2 = '2';
const UUID_NONCE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HEX_SIGNATURE = /^[0-9a-f]{64}$/i;

function sha256Hex(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function hmacHex(secret, message) {
  return crypto.createHmac('sha256', secret).update(message).digest('hex');
}

function safeEqHex(received, expected) {
  if (!HEX_SIGNATURE.test(received) || !HEX_SIGNATURE.test(expected)) return false;
  const receivedBuffer = Buffer.from(received, 'hex');
  const expectedBuffer = Buffer.from(expected, 'hex');
  return receivedBuffer.length === expectedBuffer.length
    && crypto.timingSafeEqual(receivedBuffer, expectedBuffer);
}

function isValidTimestamp(value) {
  if (!/^\d+$/.test(value)) return false;
  const timestamp = Number(value);
  return Number.isSafeInteger(timestamp);
}

function isValidNonce(value) {
  return UUID_NONCE.test(value);
}

function isMultipart(req) {
  return req.headers['content-type']?.toLowerCase().includes('multipart/form-data');
}

function canonicalMessage({ version, timestamp, nonce, method, path, bodyHash }) {
  // v2 is intentionally versioned in the signed material. JSON requests are
  // signed by their raw-body hash, which covers objectKey + hash from T07.
  if (version === HMAC_V2) {
    return `v2.${timestamp}.${nonce}.${method}.${path}.${bodyHash}`;
  }
  // v1 is retained only for the development migration window.
  return `${timestamp}.${nonce}.${method}.${path}.${bodyHash}`;
}

export class HmacMiddleware {
  constructor({ clientId = env.CLIENT_ID, clientSecret = env.CLIENT_SECRET } = {}) {
    this.clientId = clientId;
    this.clientSecret = clientSecret;
  }

  async verify(req, res, next) {
    try {
      const id = req.header('X-App-Id');
      const timestamp = req.header('X-App-Timestamp');
      const nonce = req.header('X-App-Nonce');
      const signature = req.header('X-App-Signature');
      const requestedVersion = req.header('X-App-Hmac-Version');
      const version = requestedVersion || (env.HMAC_LEGACY_V1_ENABLED ? '1' : null);

      if (!id || !timestamp || !nonce || !signature || !version) {
        return res.status(401).json({ error: 'Missing signature headers' });
      }

      if (version !== '1' && version !== HMAC_V2) {
        return res.status(401).json({ error: 'Unsupported HMAC version' });
      }
      if (version === '1' && !env.HMAC_LEGACY_V1_ENABLED) {
        return res.status(401).json({ error: 'Legacy HMAC version disabled' });
      }
      if (id !== this.clientId) {
        return res.status(401).json({ error: 'Invalid app id' });
      }
      if (!isValidTimestamp(timestamp)) {
        return res.status(401).json({ error: 'Stale/invalid timestamp' });
      }
      if (!isValidNonce(nonce)) {
        return res.status(401).json({ error: 'Invalid nonce' });
      }
      if (!HEX_SIGNATURE.test(signature)) {
        return res.status(401).json({ error: 'Invalid signature format' });
      }

      const now = Math.floor(Date.now() / 1000);
      const timestampNumber = Number(timestamp);
      if (Math.abs(now - timestampNumber) > env.SIG_WINDOW_SEC) {
        return res.status(401).json({ error: 'Stale/invalid timestamp' });
      }

      if (version === '1' && env.NODE_ENV === 'production') {
        return res.status(401).json({ error: 'Legacy HMAC version disabled' });
      }

      const method = req.method.toUpperCase();
      const path = req.originalUrl.split('?')[0];
      const raw = isMultipart(req) ? Buffer.from('') : (req.rawBody ?? Buffer.from(''));
      const bodyHash = sha256Hex(raw);
      const message = canonicalMessage({
        version,
        timestamp,
        nonce,
        method,
        path,
        bodyHash
      });
      const expected = hmacHex(this.clientSecret, message);

      if (!safeEqHex(signature, expected)) {
        return res.status(401).json({ error: 'Bad signature' });
      }

      const redisSecurity = req.app.locals.redisSecurity;
      const claimed = await redisSecurity.claimNonce({
        clientId: id,
        nonce,
        windowSeconds: env.SIG_WINDOW_SEC
      });
      if (!claimed) {
        return res.status(401).json({ error: 'Replay detected' });
      }

      req.hmacVersion = version;
      req.mobileIntegrity = {
        provider: req.header('X-Integrity-Provider') || null,
        token: req.header('X-Integrity-Token') || null
      };
      return next();
    } catch (error) {
      console.error('HMAC verify error:', error.message);
      return res.status(503).json({
        error: 'Security service unavailable',
        message: 'Request temporarily unavailable'
      });
    }
  }

  getMiddleware() {
    return (req, res, next) => {
      this.verify(req, res, next).catch(error => {
        console.error('[HMAC] Unhandled error:', error.message);
        res.status(503).json({
          error: 'Security service unavailable',
          message: 'Request temporarily unavailable'
        });
      });
    };
  }
}

export const hmacMiddleware = new HmacMiddleware();
export const requireHmac = hmacMiddleware.getMiddleware();

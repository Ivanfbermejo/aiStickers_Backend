import crypto from 'crypto';
import { env } from '../../../config/env.js';

// Helper functions (exactly from clientSign.middleware.js)
function sha256Hex(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function hmacHex(secret, str) {
  return crypto.createHmac('sha256', secret).update(str).digest('hex');
}

function safeEqHex(a, b) {
  const A = Buffer.from(a, 'hex');
  const B = Buffer.from(b, 'hex');
  return A.length === B.length && crypto.timingSafeEqual(A, B);
}

/**
 * HMAC Middleware for request authentication
 * Exact copy of clientSign.middleware.js logic
 */
export class HmacMiddleware {
  constructor() {
    this.clientId = env.CLIENT_ID;
    this.clientSecret = env.CLIENT_SECRET;
  }
  
  /**
   * Verify HMAC signature (exact copy from clientSign.middleware.js)
   */
  async verify(req, res, next) {
    process.stdout.write(`[HMAC] ${req.method} ${req.path}\n`);
    try {
      const id = req.header('X-App-Id');
      const ts = req.header('X-App-Timestamp'); // epoch segundos
      const n = req.header('X-App-Nonce');       // uuid
      const sig = req.header('X-App-Signature'); // hex

      if (!id || !ts || !n || !sig) {
        console.log('\n🔒 Missing signature headers\n');
        return res.status(401).json({ error: 'Missing signature headers' });
      }

      if (id !== this.clientId) {
        console.log('\n🔒 Invalid app id\n');
        return res.status(401).json({ error: 'Invalid app id' });
      }

      const now = Math.floor(Date.now() / 1000);
      const t = Number(ts);
      if (!Number.isFinite(t) || Math.abs(now - t) > env.SIG_WINDOW_SEC) {
        console.log('\n🔒 Stale/invalid timestamp\n');
        return res.status(401).json({ error: 'Stale/invalid timestamp' });
      }

      // Construimos mensaje canónico (exact copy from clientSign.middleware.js)
      const method = req.method.toUpperCase();
      const path = req.originalUrl.split('?')[0];
      const raw = req.rawBody ?? Buffer.from('');
      const bodyHash = sha256Hex(raw);

      const msg = `${t}.${n}.${method}.${path}.${bodyHash}`;
      const expected = hmacHex(this.clientSecret, msg);

      process.stdout.write(`[HMAC] bodyHash=${bodyHash.substring(0,10)} received=${sig.substring(0,10)} expected=${expected.substring(0,10)}\n`);

      if (!safeEqHex(sig, expected)) {
        process.stdout.write(`[HMAC] ❌ Bad signature\n`);
        return res.status(401).json({ error: 'Bad signature' });
      }

      process.stdout.write(`[HMAC] ✅ OK\n`);
      return next();
    } catch (e) {
      console.error('HMAC verify error:', e);
      return res.status(401).json({ error: 'Signature check failed' });
    }
  }
  
  /**
   * Get Express middleware function
   */
  getMiddleware() {
    return (req, res, next) => {
      this.verify(req, res, next).catch((err) => {
        console.error('[HMAC] Unhandled error:', err);
        res.status(500).json({ error: 'Internal error in HMAC verification' });
      });
    };
  }
}

// Singleton instance
export const hmacMiddleware = new HmacMiddleware();
export const requireHmac = hmacMiddleware.getMiddleware();

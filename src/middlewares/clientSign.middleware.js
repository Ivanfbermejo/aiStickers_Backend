// src/middlewares/clientSign.middleware.js
import crypto from "crypto";
import env from "../utils/env.js";

function sha256Hex(buf) {
  return crypto.createHash("sha256").update(buf).digest("hex");
}
function hmacHex(secret, str) {
  return crypto.createHmac("sha256", secret).update(str).digest("hex");
}
function safeEqHex(a, b) {
  const A = Buffer.from(a, "hex");
  const B = Buffer.from(b, "hex");
  return A.length === B.length && crypto.timingSafeEqual(A, B);
}

export function requireClientSignature(req, res, next) {
  try {
    const id  = req.header("X-App-Id");
    const ts  = req.header("X-App-Timestamp"); // epoch segundos
    const n   = req.header("X-App-Nonce");     // uuid
    const sig = req.header("X-App-Signature"); // hex

    if (!id || !ts || !n || !sig) {
      return res.status(401).json({ error: "Missing signature headers" });
    }
    if (id !== env.CLIENT_ID) {
      return res.status(401).json({ error: "Invalid app id" });
    }

    const now = Math.floor(Date.now() / 1000);
    const t = Number(ts);
    if (!Number.isFinite(t) || Math.abs(now - t) > env.SIG_WINDOW_SEC) {
      return res.status(401).json({ error: "Stale/invalid timestamp" });
    }

    // Construimos mensaje canónico
    const method = req.method.toUpperCase();
    const path   = req.originalUrl.split("?")[0];
    const raw    = req.rawBody ?? Buffer.from(""); // ver index.js abajo
    const bodyHash = sha256Hex(raw);

    const msg = `${t}.${n}.${method}.${path}.${bodyHash}`;
    const expected = hmacHex(env.CLIENT_SECRET, msg);

    if (!safeEqHex(sig, expected)) {
      return res.status(401).json({ error: "Bad signature" });
    }

    // (Opcional anti-replay): guarda 'n' durante SIG_WINDOW_SEC y rechaza si se repite.
    return next();
  } catch (e) {
    console.error("HMAC verify error:", e);
    return res.status(401).json({ error: "Signature check failed" });
  }
}

import crypto from 'node:crypto';

export function sha256Hex(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

export function hmacHex(secret, str) {
  return crypto.createHmac('sha256', secret).update(str).digest('hex');
}

/**
 * Build HMAC headers matching the server middleware.
 * @param {Object} opts
 * @param {string} opts.method HTTP method
 * @param {string} opts.path Original URL path (no query)
 * @param {any} [opts.body] JSON body or Buffer
 * @param {string} opts.clientId
 * @param {string} opts.clientSecret
 * @param {number} [opts.timestamp] Unix seconds
 * @param {string} [opts.nonce] UUID
 * @param {string|number} [opts.version] HMAC protocol version
 */
export function signRequest({
  method = 'GET',
  path,
  body,
  clientId,
  clientSecret,
  timestamp,
  nonce,
  version = '2'
}) {
  const ts = timestamp ?? Math.floor(Date.now() / 1000);
  const n = nonce ?? crypto.randomUUID();
  let raw;
  if (Buffer.isBuffer(body)) {
    raw = body;
  } else if (body === undefined || body === null) {
    raw = Buffer.from('');
  } else {
    raw = Buffer.from(JSON.stringify(body));
  }
  const bodyHash = sha256Hex(raw);
  const msg = version === '2'
    ? `v2.${ts}.${n}.${method.toUpperCase()}.${path}.${bodyHash}`
    : `${ts}.${n}.${method.toUpperCase()}.${path}.${bodyHash}`;
  const sig = hmacHex(clientSecret, msg);

  return {
    'X-App-Id': clientId,
    'X-App-Timestamp': String(ts),
    'X-App-Nonce': n,
    'X-App-Signature': sig,
    'X-App-Hmac-Version': String(version)
  };
}

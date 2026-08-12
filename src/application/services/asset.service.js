import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { randomId } from '../../utils/random-id.util.js';
import {
  validateImageBuffer,
  downloadSecureUrl,
  getTrustedProviderHosts,
  parseDataUri
} from './secure-asset.service.js';

const ALLOWED_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'webp', 'gif']);
const MIME_BY_FORMAT = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif'
};

function normalizeMetadata(metadata = {}) {
  const aliases = {
    ownerid: 'ownerId',
    sizebytes: 'sizeBytes',
    mimetype: 'mimeType',
    sourceurl: 'sourceUrl',
    migratedfrom: 'migratedFrom'
  };
  const normalized = {};
  for (const [key, value] of Object.entries(metadata)) {
    normalized[aliases[key.toLowerCase()] || key] = value;
  }
  for (const numeric of ['sizeBytes', 'width', 'height']) {
    if (normalized[numeric] !== undefined) normalized[numeric] = Number(normalized[numeric]);
  }
  return normalized;
}

export class AssetService {
  constructor({ storage, jwtSecret, jwtIssuer, jwtAudience, baseUrl = '', signedUrlExpirySeconds = 300 }) {
    this.storage = storage;
    this.jwtSecret = jwtSecret;
    this.jwtIssuer = jwtIssuer;
    this.jwtAudience = jwtAudience;
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.signedUrlExpirySeconds = signedUrlExpirySeconds;
  }

  /**
   * Generate a random object key. The original filename is never used.
   */
  generateKey(format, { ownerId, idempotencyKey } = {}) {
    const ext = format.toLowerCase();
    if (!ALLOWED_EXTENSIONS.has(ext)) {
      throw new Error(`Unsupported asset format: ${format}`);
    }
    if (idempotencyKey) {
      const digest = crypto
        .createHmac('sha256', this.jwtSecret)
        .update(`${ownerId}:${idempotencyKey}`)
        .digest('hex');
      return `${digest}.${ext}`;
    }
    return `${randomId(32)}.${ext}`;
  }

  sha256(buffer) {
    return crypto.createHash('sha256').update(buffer).digest('hex');
  }

  /**
   * Validate, hash, and store an image buffer.
   * Returns metadata including the private object key.
   */
  async storeValidatedBuffer({ buffer, ownerId, declaredMimeType, idempotencyKey }) {
    if (!ownerId) {
      throw new Error('ownerId is required');
    }

    const meta = await validateImageBuffer(buffer);
    const detectedMimeType = MIME_BY_FORMAT[meta.format];

    if (declaredMimeType && declaredMimeType.toLowerCase() !== detectedMimeType) {
      throw new Error('Declared MIME type does not match image content');
    }

    const hash = this.sha256(buffer);
    const key = this.generateKey(meta.format, { ownerId, idempotencyKey });
    const expected = {
      ownerId,
      hash,
      sizeBytes: buffer.length,
      mimeType: detectedMimeType,
      width: meta.width,
      height: meta.height
    };

    if (await this.storage.objectExists(key)) {
      const existing = await this.readVerifiedObject({ key, ownerId });
      if (existing.metadata.hash !== hash) {
        throw new Error('Idempotency key already refers to different bytes');
      }
      return { key, format: meta.format, ...expected };
    }

    await this.storage.putObject(key, buffer, expected);

    try {
      await this.readVerifiedObject({ key, ownerId });
    } catch (error) {
      await this.storage.deleteObject(key).catch(() => {});
      throw error;
    }

    return {
      key,
      format: meta.format,
      ...expected
    };
  }

  /**
   * Download an external image and copy it into our private storage.
   */
  async copyExternalToStorage({ url, ownerId, maxBytes, allowlist = getTrustedProviderHosts(), idempotencyKey }) {
    const buffer = await downloadSecureUrl(url, { maxBytes, allowlist });
    return this.storeValidatedBuffer({ buffer, ownerId, idempotencyKey });
  }

  async ingestClientAsset({ reference, buffer, declaredMimeType, ownerId, allowlist, idempotencyKey }) {
    if (buffer) {
      return this.storeValidatedBuffer({ buffer, ownerId, declaredMimeType, idempotencyKey });
    }
    if (!reference || typeof reference !== 'string') {
      throw new Error('Asset reference or buffer is required');
    }
    if (reference.startsWith('data:')) {
      const parsed = parseDataUri(reference);
      return this.storeValidatedBuffer({
        buffer: parsed.buffer,
        ownerId,
        declaredMimeType: parsed.mimeType,
        idempotencyKey
      });
    }
    if (reference.startsWith('/api/v1/assets/')) {
      const parsed = new URL(reference, 'http://localhost');
      const key = decodeURIComponent(parsed.pathname.slice('/api/v1/assets/'.length));
      const token = parsed.searchParams.get('token');
      if (token && this.verifySignedToken(token) !== key) {
        throw new Error('Asset token does not match requested key');
      }
      const verified = await this.readVerifiedObject({ key, ownerId });
      return {
        key,
        format: verified.format,
        hash: verified.metadata.hash,
        sizeBytes: verified.metadata.sizeBytes,
        mimeType: verified.metadata.mimeType,
        width: verified.metadata.width,
        height: verified.metadata.height,
        ownerId: verified.metadata.ownerId
      };
    }
    if (reference.startsWith('/uploads/')) {
      throw new Error('Legacy /uploads references must be migrated before use');
    }
    return this.copyExternalToStorage({
      url: reference,
      ownerId,
      allowlist,
      idempotencyKey
    });
  }

  async readVerifiedObject({ key, ownerId }) {
    const { buffer, metadata: rawMetadata } = await this.storage.getObject(key);
    const metadata = normalizeMetadata(rawMetadata);
    const required = ['ownerId', 'hash', 'sizeBytes', 'mimeType', 'width', 'height'];
    for (const field of required) {
      if (metadata[field] === undefined || metadata[field] === null || metadata[field] === '') {
        throw new Error(`Stored object metadata is incomplete: ${field}`);
      }
    }
    if (ownerId && metadata.ownerId !== ownerId) {
      throw new Error('Asset does not belong to the requested owner');
    }
    if (!Buffer.isBuffer(buffer) || buffer.length === 0 || buffer.length !== metadata.sizeBytes) {
      throw new Error('Stored object bytes are incomplete');
    }
    if (this.sha256(buffer) !== metadata.hash) {
      throw new Error('Stored object hash does not match metadata');
    }
    const detected = await validateImageBuffer(buffer);
    const detectedMimeType = MIME_BY_FORMAT[detected.format];
    if (detectedMimeType !== metadata.mimeType) {
      throw new Error('Stored object MIME does not match its bytes');
    }
    if (detected.width !== metadata.width || detected.height !== metadata.height) {
      throw new Error('Stored object dimensions do not match metadata');
    }
    return { buffer, metadata, format: detected.format };
  }

  /**
   * Read object metadata and verify ownership.
   */
  async verifyOwnership(key, ownerId) {
    const metadata = normalizeMetadata(await this.storage.getObjectMetadata(key));
    if (!metadata.ownerId || metadata.ownerId !== ownerId) {
      throw new Error('Asset does not belong to the requested owner');
    }
    return metadata;
  }

  /**
   * Return a short-lived signed URL for an object owned by ownerId.
   * For the local driver this returns an API-relative URL with a signed token.
   */
  async getSignedUrl(key, ownerId, expiresInSeconds = this.signedUrlExpirySeconds) {
    await this.verifyOwnership(key, ownerId);

    const base = await this.storage.getSignedUrl(key, expiresInSeconds);

    // S3-compatible drivers already return a complete signed URL.
    if (!base.startsWith('/api/v1/assets/')) {
      return base;
    }

    // Local driver: append a signed JWT token.
    const token = jwt.sign(
      { key, aud: this.jwtAudience, iss: this.jwtIssuer },
      this.jwtSecret,
      { expiresIn: expiresInSeconds, jwtid: `asset-${key}` }
    );
    return `${this.baseUrl}${base}?token=${encodeURIComponent(token)}`;
  }

  /**
   * Verify a local signed-asset token and return the key it grants access to.
   */
  verifySignedToken(token) {
    try {
      const payload = jwt.verify(token, this.jwtSecret, {
        audience: this.jwtAudience,
        issuer: this.jwtIssuer
      });
      return payload.key;
    } catch {
      throw new Error('Invalid or expired asset token');
    }
  }

  /**
   * Stream an object to a response after verifying ownership or token.
   */
  async streamToResponse({ key, ownerId, token, res }) {
    let metadata;
    if (token) {
      const tokenKey = this.verifySignedToken(token);
      if (tokenKey !== key) {
        throw new Error('Asset token does not match requested key');
      }
      metadata = normalizeMetadata(await this.storage.getObjectMetadata(key));
    } else if (ownerId) {
      metadata = await this.verifyOwnership(key, ownerId);
    } else {
      throw new Error('ownerId or token is required');
    }

    const verified = await this.readVerifiedObject({ key, ownerId: token ? undefined : ownerId });
    const { buffer } = verified;
    metadata = verified.metadata;
    res.setHeader('Content-Type', metadata.mimeType || 'application/octet-stream');
    res.setHeader('Content-Length', buffer.length);
    res.setHeader('Cache-Control', 'private, no-store');
    res.send(buffer);
  }

  /**
   * Delete an object if it is owned by ownerId. Idempotent: missing objects
   * are silently ignored.
   */
  async deleteIfOwned(key, ownerId) {
    try {
      await this.verifyOwnership(key, ownerId);
    } catch (err) {
      if (err.message?.includes('does not belong')) throw err;
      // Missing metadata/object is treated as already deleted.
      if (err.code === 'ENOENT' || err.name === 'NotFound' || err.name === 'NoSuchKey') {
        return { deleted: false, reason: 'already_missing' };
      }
      throw err;
    }

    await this.storage.deleteObject(key);
    return { deleted: true };
  }
}

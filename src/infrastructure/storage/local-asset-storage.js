import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { AssetStorage } from '../../application/storage/asset-storage.js';

/**
 * Local file-system implementation of AssetStorage.
 *
 * Restricted to development and automated tests. Production uses the
 * S3-compatible driver so assets do not depend on the application filesystem.
 *
 * Objects are stored under <baseDir>/<bucket>/key and a sidecar metadata file
 * keeps ownership and validation metadata: <baseDir>/<bucket>/key.meta.json.
 */
export class LocalAssetStorage extends AssetStorage {
  constructor({ baseDir, bucket = 'aistickers-private-assets' }) {
    super();
    this.baseDir = baseDir;
    this.bucket = bucket;
    this.root = path.join(baseDir, bucket);
    fs.mkdirSync(this.root, { recursive: true });
  }

  _objectPath(key) {
    const safeKey = key.replace(/\\/g, '/').replace(/^\/+/, '');
    if (!safeKey || safeKey.split('/').some(segment => segment === '..' || segment === '.')) {
      throw new Error('Invalid object key');
    }
    const resolved = path.resolve(this.root, safeKey);
    const rootPrefix = `${path.resolve(this.root)}${path.sep}`;
    if (!resolved.startsWith(rootPrefix)) {
      throw new Error('Invalid object key');
    }
    return resolved;
  }

  _metaPath(key) {
    return `${this._objectPath(key)}.meta.json`;
  }

  async putObject(key, buffer, metadata = {}) {
    const filePath = this._objectPath(key);
    const metaPath = this._metaPath(key);
    const suffix = `.tmp-${process.pid}-${crypto.randomUUID()}`;
    const tempFilePath = `${filePath}${suffix}`;
    const tempMetaPath = `${metaPath}${suffix}`;
    await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
    try {
      await fs.promises.writeFile(tempFilePath, buffer, { flag: 'wx' });
      await fs.promises.writeFile(
        tempMetaPath,
        JSON.stringify({ ...metadata, storedAt: new Date().toISOString() }, null, 2),
        { flag: 'wx' }
      );
      await fs.promises.rename(tempFilePath, filePath);
      await fs.promises.rename(tempMetaPath, metaPath);
    } finally {
      await fs.promises.rm(tempFilePath, { force: true });
      await fs.promises.rm(tempMetaPath, { force: true });
    }
  }

  async getObject(key) {
    const filePath = this._objectPath(key);
    const [buffer, metadata] = await Promise.all([
      fs.promises.readFile(filePath),
      fs.promises.readFile(this._metaPath(key), 'utf8').then(JSON.parse).catch(() => ({}))
    ]);
    return { buffer, metadata };
  }

  async getObjectMetadata(key) {
    const raw = await fs.promises.readFile(this._metaPath(key), 'utf8');
    return JSON.parse(raw);
  }

  async objectExists(key) {
    try {
      await fs.promises.access(this._objectPath(key), fs.constants.F_OK);
      return true;
    } catch {
      return false;
    }
  }

  async deleteObject(key) {
    const filePath = this._objectPath(key);
    const metaPath = this._metaPath(key);
    await fs.promises.rm(filePath, { force: true });
    await fs.promises.rm(metaPath, { force: true });
  }

  async listObjects(prefix = '') {
    const results = [];
    const prefixPath = prefix ? this._objectPath(prefix) : this.root;
    try {
      await fs.promises.access(prefixPath);
    } catch {
      return results;
    }

    const walk = async (dir) => {
      const entries = await fs.promises.readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          await walk(full);
        } else if (!entry.name.endsWith('.meta.json')) {
          const rel = path.relative(this.root, full).replace(/\\/g, '/');
          results.push(rel);
        }
      }
    };

    const stats = await fs.promises.stat(prefixPath);
    if (stats.isDirectory()) {
      await walk(prefixPath);
    } else {
      const rel = path.relative(this.root, prefixPath).replace(/\\/g, '/');
      results.push(rel);
    }
    return results;
  }

  /**
   * Local signed URLs are simulated as API-relative URLs with a short-lived
   * token that the authenticated asset endpoint can verify. The actual token
   * generation lives in AssetService so this driver stays storage-only.
   */
  async getSignedUrl(key, expiresInSeconds = 300) {
    // The token is generated and appended by AssetService; this driver only
    // returns the base path.
    return `/api/v1/assets/${key}`;
  }
}

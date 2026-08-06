import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  DeleteObjectCommand,
  ListObjectsV2Command,
  ServerSideEncryption
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { AssetStorage } from '../../application/storage/asset-storage.js';

const DEFAULT_MAX_OBJECT_BYTES = 10 * 1024 * 1024;

function normalizeMetadata(metadata = {}, response = {}) {
  const normalized = {};
  const aliases = {
    ownerid: 'ownerId',
    hash: 'hash',
    sizebytes: 'sizeBytes',
    mimetype: 'mimeType',
    width: 'width',
    height: 'height',
    sourceurl: 'sourceUrl',
    migratedfrom: 'migratedFrom'
  };
  for (const [key, value] of Object.entries(metadata)) {
    normalized[aliases[key.toLowerCase()] || key] = value;
  }
  if (normalized.sizeBytes === undefined && response.ContentLength !== undefined) {
    normalized.sizeBytes = response.ContentLength;
  }
  if (normalized.mimeType === undefined && response.ContentType) {
    normalized.mimeType = response.ContentType;
  }
  return normalized;
}

/**
 * S3-compatible implementation of AssetStorage.
 *
 * Supports AWS S3 and providers that expose the S3 API. Objects are
 * always server-side encrypted and private; public ACLs are never used.
 */
export class S3AssetStorage extends AssetStorage {
  constructor({
    endpoint,
    region,
    bucket,
    accessKeyId,
    secretAccessKey,
    forcePathStyle = false,
    prefix = '',
    maxObjectBytes = DEFAULT_MAX_OBJECT_BYTES
  }) {
    super();
    this.bucket = bucket;
    this.prefix = prefix ? `${prefix.replace(/\/$/, '')}/` : '';
    this.maxObjectBytes = maxObjectBytes;
    this.client = new S3Client({
      endpoint,
      region: region || 'us-east-1',
      credentials: accessKeyId && secretAccessKey
        ? { accessKeyId, secretAccessKey }
        : undefined,
      forcePathStyle
    });
  }

  _prefixed(key) {
    const safeKey = key.replace(/\\/g, '/').replace(/^\/+/, '');
    if (!safeKey || safeKey.split('/').some(segment => segment === '..' || segment === '.')) {
      throw new Error('Invalid object key');
    }
    return `${this.prefix}${safeKey}`;
  }

  async putObject(key, buffer, metadata = {}) {
    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: this._prefixed(key),
      Body: buffer,
      ContentType: metadata.mimeType || 'application/octet-stream',
      Metadata: Object.fromEntries(
        Object.entries(metadata)
          .filter(([, v]) => v !== undefined && v !== null)
          .map(([k, v]) => [k, String(v)])
      ),
      ServerSideEncryption: ServerSideEncryption.AES256
    });
    await this.client.send(command);
  }

  async getObject(key) {
    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: this._prefixed(key)
    });
    const response = await this.client.send(command);
    if (!response.Body || !response.ContentLength || response.ContentLength > this.maxObjectBytes) {
      throw new Error('Stored object is empty or exceeds the allowed size');
    }
    const chunks = [];
    let size = 0;
    for await (const chunk of response.Body) {
      size += chunk.length;
      if (size > this.maxObjectBytes) {
        throw new Error('Stored object exceeds the allowed size');
      }
      chunks.push(chunk);
    }
    const buffer = Buffer.concat(chunks);
    if (buffer.length !== response.ContentLength) {
      throw new Error('Stored object is incomplete');
    }
    return {
      buffer,
      metadata: normalizeMetadata(response.Metadata, response)
    };
  }

  async getObjectMetadata(key) {
    const command = new HeadObjectCommand({
      Bucket: this.bucket,
      Key: this._prefixed(key)
    });
    const response = await this.client.send(command);
    return normalizeMetadata(response.Metadata, response);
  }

  async objectExists(key) {
    try {
      await this.getObjectMetadata(key);
      return true;
    } catch (err) {
      if (err.name === 'NotFound' || err.name === 'NoSuchKey' || err.$metadata?.httpStatusCode === 404) return false;
      throw err;
    }
  }

  async deleteObject(key) {
    const command = new DeleteObjectCommand({
      Bucket: this.bucket,
      Key: this._prefixed(key)
    });
    await this.client.send(command);
  }

  async listObjects(prefix = '') {
    const results = [];
    let continuationToken;
    const basePrefix = prefix
      ? `${this._prefixed(prefix).replace(/\/$/, '')}/`
      : this.prefix;

    do {
      const command = new ListObjectsV2Command({
        Bucket: this.bucket,
        Prefix: basePrefix,
        ContinuationToken: continuationToken,
        MaxKeys: 1000
      });
      const response = await this.client.send(command);
      for (const item of response.Contents || []) {
        const full = item.Key || '';
        const relative = full.startsWith(this.prefix) ? full.slice(this.prefix.length) : full;
        results.push(relative);
      }
      continuationToken = response.NextContinuationToken;
    } while (continuationToken);

    return results;
  }

  async getSignedUrl(key, expiresInSeconds = 300) {
    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: this._prefixed(key)
    });
    return getSignedUrl(this.client, command, { expiresIn: expiresInSeconds });
  }
}

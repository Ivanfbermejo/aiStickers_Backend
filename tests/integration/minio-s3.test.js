import { describe, it, expect } from 'vitest';
import crypto from 'node:crypto';
import sharp from 'sharp';
import { S3AssetStorage } from '../../src/infrastructure/storage/s3-asset-storage.js';
import { AssetService } from '../../src/application/services/asset.service.js';

const enabled = process.env.RUN_MINIO_INTEGRATION === 'true';
const describeMinio = enabled ? describe : describe.skip;
const endpoint = process.env.MINIO_ENDPOINT || 'http://127.0.0.1:9000';
const bucket = process.env.MINIO_BUCKET || 'aistickers-private-assets';

function storage(prefix) {
  return new S3AssetStorage({
    endpoint,
    bucket,
    region: process.env.MINIO_REGION || 'us-east-1',
    accessKeyId: process.env.MINIO_ACCESS_KEY_ID || 'minioadmin',
    secretAccessKey: process.env.MINIO_SECRET_ACCESS_KEY || 'minioadmin123',
    forcePathStyle: true,
    prefix
  });
}

function service(s3) {
  return new AssetService({
    storage: s3,
    jwtSecret: 'test_jwt_secret_minimum_32_chars_long',
    jwtIssuer: 'aiStickers-test',
    jwtAudience: 'aiStickers-backend-test'
  });
}

describeMinio('MinIO S3 private storage', () => {
  it('does real put/get/head, preserves metadata through client recreation, signs, isolates and deletes', async () => {
    const prefix = `ci/${crypto.randomUUID()}`;
    const first = service(storage(prefix));
    const buffer = await sharp({ create: { width: 12, height: 9, channels: 3, background: 'green' } }).png().toBuffer();
    const asset = await first.storeValidatedBuffer({ buffer, ownerId: 'owner-a' });

    const head = await first.storage.getObjectMetadata(asset.key);
    expect(head.ownerId).toBe('owner-a');
    expect(Number(head.sizeBytes)).toBe(buffer.length);
    expect(head.mimeType).toBe('image/png');
    expect(await first.storage.objectExists(asset.key)).toBe(true);

    // This recreates the storage client against the persistent MinIO bucket.
    const second = service(storage(prefix));
    const retrieved = await second.readVerifiedObject({ key: asset.key, ownerId: 'owner-a' });
    expect(retrieved.buffer.equals(buffer)).toBe(true);
    await expect(second.getSignedUrl(asset.key, 'owner-b')).rejects.toThrow(/does not belong/);

    const signedUrl = await second.getSignedUrl(asset.key, 'owner-a');
    const signed = await fetch(signedUrl);
    expect(signed.status).toBe(200);
    expect(Buffer.from(await signed.arrayBuffer()).equals(buffer)).toBe(true);

    const unsigned = await fetch(`${endpoint}/${bucket}/${prefix}/${asset.key}`);
    expect(unsigned.status).toBe(403);

    await second.deleteIfOwned(asset.key, 'owner-a');
    await second.deleteIfOwned(asset.key, 'owner-a');
    expect(await second.storage.objectExists(asset.key)).toBe(false);
  }, 30000);
});

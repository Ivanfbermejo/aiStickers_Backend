import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { LocalAssetStorage } from '../../src/infrastructure/storage/local-asset-storage.js';
import { AssetService } from '../../src/application/services/asset.service.js';

async function makePngBuffer(width = 32, height = 32) {
  return sharp({
    create: { width, height, channels: 3, background: 'blue' }
  })
    .png()
    .toBuffer();
}

function makeAssetService(baseDir) {
  const storage = new LocalAssetStorage({ baseDir });
  return new AssetService({
    storage,
    jwtSecret: 'test_jwt_secret_minimum_32_chars_long',
    jwtIssuer: 'aiStickers-test',
    jwtAudience: 'aiStickers-backend-test',
    baseUrl: '',
    signedUrlExpirySeconds: 300
  });
}

describe('Object storage', () => {
  let baseDir;

  beforeEach(() => {
    baseDir = mkdtempSync(join(tmpdir(), 'aistickers-storage-test-'));
  });

  afterEach(() => {
    rmSync(baseDir, { recursive: true, force: true });
  });

  describe('LocalAssetStorage', () => {
    it('stores and retrieves an object with metadata', async () => {
      const storage = new LocalAssetStorage({ baseDir });
      const buffer = await makePngBuffer();
      await storage.putObject('a/b/test.png', buffer, { ownerId: 'user-1', hash: 'abc' });

      const { buffer: retrieved, metadata } = await storage.getObject('a/b/test.png');
      expect(retrieved.equals(buffer)).toBe(true);
      expect(metadata.ownerId).toBe('user-1');
      expect(storage.objectExists('a/b/test.png')).resolves.toBe(true);
    });

    it('rejects directory traversal in keys', async () => {
      const storage = new LocalAssetStorage({ baseDir });
      await expect(storage.putObject('../etc/passwd', Buffer.from('x'))).rejects.toThrow('Invalid object key');
    });

    it('lists objects by prefix', async () => {
      const storage = new LocalAssetStorage({ baseDir });
      await storage.putObject('user-1/a.png', Buffer.from('a'), { ownerId: 'u1' });
      await storage.putObject('user-1/b.png', Buffer.from('b'), { ownerId: 'u1' });
      await storage.putObject('user-2/c.png', Buffer.from('c'), { ownerId: 'u2' });
      const list = await storage.listObjects('user-1');
      expect(list.sort()).toEqual(['user-1/a.png', 'user-1/b.png']);
    });

    it('deletes objects idempotently', async () => {
      const storage = new LocalAssetStorage({ baseDir });
      await storage.putObject('delete-me.png', Buffer.from('x'), { ownerId: 'u1' });
      await storage.deleteObject('delete-me.png');
      await expect(storage.getObject('delete-me.png')).rejects.toThrow();
      await storage.deleteObject('delete-me.png'); // should not throw
    });

    it('persists objects after recreating the storage instance', async () => {
      const storage1 = new LocalAssetStorage({ baseDir });
      const buffer = await makePngBuffer();
      await storage1.putObject('persist.png', buffer, { ownerId: 'u1', hash: 'h1' });

      const storage2 = new LocalAssetStorage({ baseDir });
      const { buffer: retrieved, metadata } = await storage2.getObject('persist.png');
      expect(retrieved.equals(buffer)).toBe(true);
      expect(metadata.hash).toBe('h1');
    });

    it('rejects an incomplete stored object', async () => {
      const service = makeAssetService(baseDir);
      const asset = await service.storeValidatedBuffer({
        buffer: await makePngBuffer(),
        ownerId: 'user-a'
      });
      writeFileSync(service.storage._objectPath(asset.key), Buffer.from('truncated'));
      await expect(service.readVerifiedObject({ key: asset.key, ownerId: 'user-a' }))
        .rejects.toThrow(/incomplete|hash|image/i);
    });
  });

  describe('AssetService', () => {
    it('stores a valid image with computed hash and dimensions', async () => {
      const service = makeAssetService(baseDir);
      const buffer = await makePngBuffer(64, 48);
      const result = await service.storeValidatedBuffer({ buffer, ownerId: 'user-a' });

      expect(result.format).toBe('png');
      expect(result.width).toBe(64);
      expect(result.height).toBe(48);
      expect(result.sizeBytes).toBe(buffer.length);
      expect(result.hash).toHaveLength(64);

      const meta = await service.storage.getObjectMetadata(result.key);
      expect(meta.ownerId).toBe('user-a');
    });

    it('reuses an idempotent copy without creating a duplicate object', async () => {
      const service = makeAssetService(baseDir);
      const buffer = await makePngBuffer();
      const first = await service.storeValidatedBuffer({
        buffer,
        ownerId: 'user-a',
        idempotencyKey: 'generation-result:job-1'
      });
      const second = await service.storeValidatedBuffer({
        buffer,
        ownerId: 'user-a',
        idempotencyKey: 'generation-result:job-1'
      });
      expect(second.key).toBe(first.key);
      expect(await service.storage.listObjects()).toEqual([first.key]);
    });

    it('rejects an empty/incomplete buffer', async () => {
      const service = makeAssetService(baseDir);
      await expect(service.storeValidatedBuffer({ buffer: Buffer.from(''), ownerId: 'u1' }))
        .rejects.toThrow('Empty or invalid image buffer');
    });

    it('rejects a fake MIME type', async () => {
      const service = makeAssetService(baseDir);
      const pngBuffer = await makePngBuffer();
      await expect(service.storeValidatedBuffer({
        buffer: pngBuffer,
        ownerId: 'u1',
        declaredMimeType: 'image/jpeg'
      })).rejects.toThrow('does not match');
    });

    it('generates signed URLs that can be verified by key', async () => {
      const service = makeAssetService(baseDir);
      const buffer = await makePngBuffer();
      const { key } = await service.storeValidatedBuffer({ buffer, ownerId: 'user-a' });

      const url = await service.getSignedUrl(key, 'user-a');
      expect(url.startsWith('/api/v1/assets/')).toBe(true);

      const parsed = new URL(url, 'http://localhost');
      const token = parsed.searchParams.get('token');
      expect(service.verifySignedToken(token)).toBe(key);
    });

    it('refuses to sign URLs for objects owned by another user', async () => {
      const service = makeAssetService(baseDir);
      const buffer = await makePngBuffer();
      const { key } = await service.storeValidatedBuffer({ buffer, ownerId: 'user-a' });

      await expect(service.getSignedUrl(key, 'user-b'))
        .rejects.toThrow('does not belong');
    });

    it('expires signed tokens', async () => {
      const service = new AssetService({
        storage: new LocalAssetStorage({ baseDir }),
        jwtSecret: 'test_jwt_secret_minimum_32_chars_long',
        jwtIssuer: 'aiStickers-test',
        jwtAudience: 'aiStickers-backend-test',
        signedUrlExpirySeconds: 1
      });
      const buffer = await makePngBuffer();
      const { key } = await service.storeValidatedBuffer({ buffer, ownerId: 'u1' });
      const url = await service.getSignedUrl(key, 'u1');
      const token = new URL(url, 'http://localhost').searchParams.get('token');

      await new Promise(r => setTimeout(r, 1100));
      expect(() => service.verifySignedToken(token)).toThrow('Invalid or expired asset token');
    });

    it('deletes assets idempotently', async () => {
      const service = makeAssetService(baseDir);
      const buffer = await makePngBuffer();
      const { key } = await service.storeValidatedBuffer({ buffer, ownerId: 'u1' });

      await service.deleteIfOwned(key, 'u1');
      await service.deleteIfOwned(key, 'u1'); // missing is idempotent
      await expect(service.storage.getObject(key)).rejects.toThrow();
    });

    it('prevents deleting assets owned by another user', async () => {
      const service = makeAssetService(baseDir);
      const buffer = await makePngBuffer();
      const { key } = await service.storeValidatedBuffer({ buffer, ownerId: 'u1' });

      await expect(service.deleteIfOwned(key, 'u2')).rejects.toThrow('does not belong');
    });
  });
});

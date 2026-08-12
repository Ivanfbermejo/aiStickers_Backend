import { describe, it, expect } from 'vitest';
import sharp from 'sharp';
import { migrationKey, sha256, copyOwnedAsset, applyGenerationReference } from '../../scripts/migrate-uploads.js';

describe('upload migration identifiers', () => {
  it('uses a deterministic per-owner key for idempotent copies', () => {
    const hash = sha256(Buffer.from('asset'));
    const input = { ownerId: 'user-a', relative: 'old/image.png', hash, format: 'png' };
    expect(migrationKey(input)).toBe(migrationKey(input));
    expect(migrationKey(input)).not.toBe(migrationKey({ ...input, ownerId: 'user-b' }));
  });

  it('does not write in dry-run and apply is idempotent with verified ownership', async () => {
    const buffer = await sharp({ create: { width: 4, height: 4, channels: 3, background: 'red' } }).png().toBuffer();
    const objects = new Map();
    let writes = 0;
    const storage = {
      objectExists: async key => objects.has(key),
      putObject: async (key, body, metadata) => { writes++; objects.set(key, { buffer: body, metadata }); },
      getObject: async key => objects.get(key)
    };
    await copyOwnedAsset({ storage, buffer, ownerId: 'owner-a', relative: 'old/a.png', dryRun: true });
    expect(writes).toBe(0);
    const first = await copyOwnedAsset({ storage, buffer, ownerId: 'owner-a', relative: 'old/a.png', dryRun: false });
    const second = await copyOwnedAsset({ storage, buffer, ownerId: 'owner-a', relative: 'old/a.png', dryRun: false });
    expect(writes).toBe(1);
    expect(second.key).toBe(first.key);
    expect(objects.get(first.key).metadata.ownerId).toBe('owner-a');
  });

  it('updates legacy generation input and result references for a safe resume', () => {
    const job = { input: { imageUrl: '/uploads/input.png' }, result: { imageUrl: '/uploads/result.png' } };
    const record = { publicUrl: '/uploads/input.png', key: 'migrated.png', hash: 'h', sizeBytes: 10, mimeType: 'image/png', width: 1, height: 1 };
    expect(applyGenerationReference(job, record)).toBe(true);
    expect(job.input).toMatchObject({ objectKey: 'migrated.png', hash: 'h' });
    expect(job.input.imageUrl).toBeUndefined();
    expect(applyGenerationReference(job, record)).toBe(false);
  });
});

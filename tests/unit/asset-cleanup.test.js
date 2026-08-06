import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AssetCleanupService } from '../../src/application/services/asset-cleanup.service.js';

describe('Asset cleanup journal', () => {
  let dataDir;

  beforeEach(() => { dataDir = mkdtempSync(join(tmpdir(), 'asset-cleanup-')); });
  afterEach(() => rmSync(dataDir, { recursive: true, force: true }));

  it('never deletes before DB confirmation and retains failures for a later retry', async () => {
    let calls = 0;
    const cleanup = new AssetCleanupService({
      dataDir,
      assetService: { deleteIfOwned: async () => { calls += 1; throw new Error('storage unavailable'); } }
    });
    const task = await cleanup.schedule({ key: 'asset.png', ownerId: 'user-a', entity: 'sticker:s1' });
    await expect(cleanup.run(task)).resolves.toEqual({ deleted: false, reason: 'not_confirmed' });
    expect(calls).toBe(0);
    await cleanup.confirm(task);
    await expect(cleanup.run(task)).rejects.toThrow('storage unavailable');
    expect(calls).toBe(1);
    expect(readFileSync(join(dataDir, 'asset-cleanup.json'), 'utf8')).toContain('asset.png');
  });
});

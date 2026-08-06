import { describe, it, expect } from 'vitest';
import { migrationKey, sha256 } from '../../scripts/migrate-uploads.js';

describe('upload migration identifiers', () => {
  it('uses a deterministic per-owner key for idempotent copies', () => {
    const hash = sha256(Buffer.from('asset'));
    const input = { ownerId: 'user-a', relative: 'old/image.png', hash, format: 'png' };
    expect(migrationKey(input)).toBe(migrationKey(input));
    expect(migrationKey(input)).not.toBe(migrationKey({ ...input, ownerId: 'user-b' }));
  });
});

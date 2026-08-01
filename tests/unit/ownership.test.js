import { describe, it, expect } from 'vitest';
import { Sticker } from '../../src/domain/entities/sticker.entity.js';
import { Package } from '../../src/domain/entities/package.entity.js';

describe('Resource ownership', () => {
  it('Sticker stores and exposes its owner', () => {
    const sticker = new Sticker({
      id: 's1',
      userId: 'owner-1',
      imageUrl: 'https://example.com/s.png'
    });
    expect(sticker.userId).toBe('owner-1');
  });

  it('Sticker requires an ID and userId', () => {
    expect(() => new Sticker({ userId: 'u1', imageUrl: 'x' })).toThrow('Sticker ID is required');
    expect(() => new Sticker({ id: 's1', imageUrl: 'x' })).toThrow('User ID is required');
  });

  it('Package stores and exposes its owner', () => {
    const pkg = Package.create({ userId: 'owner-2', name: 'My Pack' });
    expect(pkg.userId).toBe('owner-2');
  });

  it('Package requires an ID, userId and name', () => {
    expect(() => new Package({ userId: 'u1', name: 'x' })).toThrow('Package ID is required');
    expect(() => new Package({ id: 'p1', name: 'x' })).toThrow('User ID is required');
    expect(() => new Package({ id: 'p1', userId: 'u1' })).toThrow('Package name is required');
  });
});

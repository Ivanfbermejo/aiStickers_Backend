import { describe, it, expect } from 'vitest';
import { Balance } from '../../src/domain/entities/balance.entity.js';

describe('Balance entity', () => {
  it('starts with zero balance by default', () => {
    const balance = new Balance({ userId: 'u1' });
    expect(balance.stickerDollars).toBe(0);
    expect(balance.hasEnough(1)).toBe(false);
  });

  it('adds StickerDollars and tracks total purchased', () => {
    const balance = new Balance({ userId: 'u1' });
    balance.add(10);
    expect(balance.stickerDollars).toBe(10);
    expect(balance.totalPurchased).toBe(10);
  });

  it('refuses to add non-positive amounts', () => {
    const balance = new Balance({ userId: 'u1' });
    expect(() => balance.add(0)).toThrow('Amount must be positive');
    expect(() => balance.add(-5)).toThrow('Amount must be positive');
  });

  it('spends StickerDollars and tracks total spent', () => {
    const balance = new Balance({ userId: 'u1', stickerDollars: 10 });
    balance.spend(3);
    expect(balance.stickerDollars).toBe(7);
    expect(balance.totalSpent).toBe(3);
  });

  it('rejects spending more than the available balance', () => {
    const balance = new Balance({ userId: 'u1', stickerDollars: 2 });
    expect(() => balance.spend(3)).toThrow('Insufficient balance');
  });

  it('rejects non-positive spend amounts', () => {
    const balance = new Balance({ userId: 'u1', stickerDollars: 10 });
    expect(() => balance.spend(0)).toThrow('Amount must be positive');
  });

  it('refunds StickerDollars', () => {
    const balance = new Balance({ userId: 'u1', stickerDollars: 5 });
    balance.refund(3);
    expect(balance.stickerDollars).toBe(8);
  });

  it('rejects non-positive refund amounts', () => {
    const balance = new Balance({ userId: 'u1' });
    expect(() => balance.refund(0)).toThrow('Amount must be positive');
  });

  it('serializes to a plain object', () => {
    const balance = new Balance({ userId: 'u1', stickerDollars: 5 });
    const json = balance.toJSON();
    expect(json.userId).toBe('u1');
    expect(json.stickerDollars).toBe(5);
    expect(json.totalPurchased).toBe(0);
  });
});

import { describe, it, expect } from 'vitest';
import { Transaction } from '../../src/domain/entities/transaction.entity.js';

describe('Transaction entity', () => {
  it('rejects invalid transaction types', () => {
    expect(() => new Transaction({
      userId: 'u1',
      type: 'UNKNOWN',
      amount: 5
    })).toThrow('Invalid transaction type');
  });

  it('rejects non-positive amounts', () => {
    expect(() => new Transaction({
      userId: 'u1',
      type: 'PURCHASE',
      amount: 0
    })).toThrow('Amount must be positive');
  });

  it('requires a user ID', () => {
    expect(() => new Transaction({
      type: 'PURCHASE',
      amount: 5
    })).toThrow('User ID is required');
  });

  it('creates a purchase with provider metadata', () => {
    const tx = Transaction.createPurchase({
      userId: 'u1',
      amount: 10,
      productId: 'com.animatedsticker.aistickers.coins_10',
      provider: 'GOOGLE_PLAY',
      providerTransactionId: 'token.abc',
      balanceAfter: 10,
      metadata: { status: 'PENDING' }
    });
    expect(tx.type).toBe('PURCHASE');
    expect(tx.providerTransactionId).toBe('token.abc');
    expect(tx.isPurchase()).toBe(true);
    expect(tx.isSpend()).toBe(false);
  });

  it('creates a spend transaction', () => {
    const tx = Transaction.createSpend({
      userId: 'u1',
      amount: 2,
      productId: 'generation',
      balanceAfter: 8
    });
    expect(tx.type).toBe('SPEND');
    expect(tx.provider).toBe('SYSTEM');
  });

  it('creates a refund transaction', () => {
    const tx = Transaction.createRefund({
      userId: 'u1',
      amount: 2,
      productId: 'generation',
      balanceAfter: 10
    });
    expect(tx.type).toBe('REFUND');
  });
});

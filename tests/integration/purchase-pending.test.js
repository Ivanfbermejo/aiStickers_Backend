import { describe, it, expect, beforeEach } from 'vitest';
import { ValidatePurchaseUseCase } from '../../src/application/use-cases/purchase/validate-purchase.use-case.js';
import { PlanService } from '../../src/application/services/plan.service.js';
import { Balance } from '../../src/domain/entities/balance.entity.js';
import { FraudDetectionService } from '../../src/infrastructure/security/fraud-detection.service.js';

class FakeBalanceRepository {
  constructor() {
    this.balances = new Map();
  }
  async findByUserId(userId) {
    const data = this.balances.get(userId);
    return data ? new Balance(data) : null;
  }
  async createForUser(userId) {
    const balance = new Balance({ userId });
    this.balances.set(userId, balance.toJSON());
    return balance;
  }
  async save(balance) {
    this.balances.set(balance.userId, balance.toJSON());
    return balance;
  }
}

class FakeTransactionRepository {
  constructor() {
    this.transactions = [];
  }
  async findByProviderTransactionId(id) {
    return this.transactions.find(t => t.providerTransactionId === id) || null;
  }
  async save(transaction) {
    this.transactions.push(transaction.toJSON());
    return transaction;
  }
}

class FakePurchaseRepository {
  constructor() {
    this.purchases = [];
  }
  async save(purchase) {
    this.purchases.push(purchase.toJSON());
    return purchase;
  }
}

class PendingPaymentProvider {
  async validatePurchase() {
    return { pending: true };
  }
}

describe('Google Play pending purchase flow (characterization)', () => {
  let balanceRepository;
  let transactionRepository;
  let purchaseRepository;
  let useCase;

  beforeEach(() => {
    balanceRepository = new FakeBalanceRepository();
    transactionRepository = new FakeTransactionRepository();
    purchaseRepository = new FakePurchaseRepository();
    useCase = new ValidatePurchaseUseCase({
      purchaseRepository,
      transactionRepository,
      balanceRepository,
      paymentProviderService: new PendingPaymentProvider(),
      fraudDetectionService: new FraudDetectionService(),
      planService: new PlanService()
    });
  });

  it('records a PENDING transaction and does not credit balance', async () => {
    const result = await useCase.execute({
      userId: 'user-1',
      productId: 'com.animatedsticker.aistickers.coins_10',
      purchaseToken: 'google-token-123',
      provider: 'GOOGLE_PLAY'
    });

    // Current behavior: pending purchases return success:false and do not credit.
    expect(result.success).toBe(false);
    expect(result.pending).toBe(true);
    expect(result.amount).toBe(10);
    expect(result.newBalance).toBe(0);

    const recorded = await transactionRepository.findByProviderTransactionId('google-token-123');
    expect(recorded).not.toBeNull();
    expect(recorded.type).toBe('PURCHASE');
    expect(recorded.metadata.status).toBe('PENDING');
    expect(recorded.balanceAfter).toBeNull();

    const balance = await balanceRepository.findByUserId('user-1');
    expect(balance).toBeNull();
  });
});

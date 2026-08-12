import { describe, it, expect, beforeEach } from 'vitest';
import { ValidatePurchaseUseCase } from '../../src/application/use-cases/purchase/validate-purchase.use-case.js';
import { PlanService } from '../../src/application/services/plan.service.js';
import { Balance } from '../../src/domain/entities/balance.entity.js';
import { FraudDetectionService } from '../../src/infrastructure/security/fraud-detection.service.js';
import { metrics } from '../../src/infrastructure/observability/metrics.js';
import { Purchase } from '../../src/domain/entities/purchase.entity.js';

class BalanceRepository {
  constructor() { this.value = null; }
  async findByUserId() { return this.value ? new Balance(this.value) : null; }
  async createForUser(userId) { this.value = new Balance({ userId }).toJSON(); return new Balance(this.value); }
  async save(balance) { this.value = balance.toJSON(); return balance; }
}

class TransactionRepository {
  constructor() { this.values = []; }
  async save(transaction) { this.values.push(transaction); return transaction; }
}

class PurchaseRepository {
  constructor() { this.values = []; }
  async findByToken(token) { return this.values.find((purchase) => purchase.purchaseToken === token) || null; }
  async save(purchase) { this.values.push(purchase); return purchase; }
}

function dependencies(unitOfWork) {
  const balance = new BalanceRepository();
  const transaction = new TransactionRepository();
  const purchase = new PurchaseRepository();
  return {
    useCase: new ValidatePurchaseUseCase({
      purchaseRepository: purchase,
      transactionRepository: transaction,
      balanceRepository: balance,
      paymentProviderService: { validatePurchase: async () => ({ valid: true, pending: false }) },
      fraudDetectionService: new FraudDetectionService(),
      planService: new PlanService(),
      unitOfWork: unitOfWork({ balance, transaction, purchase })
    }),
    balance,
    purchase
  };
}

async function metricValue(name, labels = {}) {
  const metric = metrics.register.getSingleMetric(name);
  const snapshot = await metric.get();
  const sample = snapshot.values.find((value) => Object.entries(labels).every(([key, expected]) => value.labels[key] === expected));
  return Number(sample?.value || 0);
}

describe('financial metrics', () => {
  beforeEach(() => metrics.reset());

  it('emits a credit metric only after the unit of work commits', async () => {
    const committed = dependencies((repositories) => ({ run: async (callback) => callback(repositories) }));
    await committed.useCase.execute({
      userId: 'user-1',
      productId: 'com.animatedsticker.aistickers.coins_10',
      purchaseToken: 'token-commit',
      provider: 'GOOGLE_PLAY'
    });
    expect(await metricValue('purchases_total', { state: 'CREDITED' })).toBe(1);

    const rolledBack = dependencies((repositories) => ({
      run: async (callback) => {
        await callback(repositories);
        throw new Error('rollback after callback');
      }
    }));
    await expect(rolledBack.useCase.execute({
      userId: 'user-2',
      productId: 'com.animatedsticker.aistickers.coins_10',
      purchaseToken: 'token-rollback',
      provider: 'GOOGLE_PLAY'
    })).rejects.toThrow('rollback');
    expect(await metricValue('purchases_total', { state: 'CREDITED' })).toBe(1);
  });

  it('does not emit refund metrics from the domain entity', async () => {
    const purchase = Purchase.create({
      userId: 'user-1',
      productId: 'com.animatedsticker.aistickers.coins_10',
      purchaseToken: 'token-refund',
      provider: 'GOOGLE_PLAY',
      stickerAmount: 10
    });
    purchase.markRefunded();
    expect(await metricValue('purchase_refunds_total')).toBe(0);
  });
});

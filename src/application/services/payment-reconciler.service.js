import { Transaction } from '../../domain/entities/transaction.entity.js';
import { Purchase } from '../../domain/entities/purchase.entity.js';
import { getLogger } from '../../infrastructure/observability/logger.js';
import { metrics } from '../../infrastructure/observability/metrics.js';

const DEFAULT_MAX_ATTEMPTS = 10;
const DEFAULT_BACKOFF_MS = 60_000; // 1 minute base
const DEFAULT_BATCH_SIZE = 100;

/**
 * Payment Reconciler Service
 *
 * Reconciles purchases stuck in RECEIVED or PENDING by asking the store
 * provider for the current state. Credits are applied inside the same unit of
 * work used by the rest of the application. Backoff, attempt limits and a safe
 * dry-run mode keep the reconciler predictable and non-destructive.
 */
export class PaymentReconcilerService {
  constructor({
    purchaseRepository,
    balanceRepository,
    transactionRepository,
    paymentProviderService,
    planService,
    unitOfWork,
    maxAttempts = DEFAULT_MAX_ATTEMPTS,
    baseBackoffMs = DEFAULT_BACKOFF_MS,
    batchSize = DEFAULT_BATCH_SIZE
  }) {
    this.purchaseRepository = purchaseRepository;
    this.balanceRepository = balanceRepository;
    this.transactionRepository = transactionRepository;
    this.paymentProviderService = paymentProviderService;
    this.planService = planService;
    this.unitOfWork = unitOfWork;
    this.maxAttempts = maxAttempts;
    this.baseBackoffMs = baseBackoffMs;
    this.batchSize = batchSize;
  }

  isEligibleForRetry(purchase) {
    if (purchase.status !== 'RECEIVED' && purchase.status !== 'PENDING') {
      return false;
    }
    if (purchase.reconcileAttempts >= this.maxAttempts) {
      return false;
    }
    if (!purchase.reconciledAt) {
      return true;
    }
    const delay = this.baseBackoffMs * 2 ** purchase.reconcileAttempts;
    const nextRun = new Date(purchase.reconciledAt).getTime() + delay;
    return Date.now() >= nextRun;
  }

  /**
   * Run one reconciliation pass.
   * @param {Object} options
   * @param {boolean} options.dryRun - Report only, do not mutate
   * @returns {Object} Summary of processed purchases
   */
  async reconcile({ dryRun = false } = {}) {
    await this.updatePendingPurchaseAge();
    const pending = await this.purchaseRepository.findPendingForReconcile(this.batchSize);
    const eligible = pending.filter((p) => this.isEligibleForRetry(p));

    const summary = {
      examined: pending.length,
      skipped: pending.length - eligible.length,
      credited: 0,
      rejected: 0,
      stillPending: 0,
      errors: 0
    };

    for (const purchase of eligible) {
      try {
        const result = await this.reconcileOne(purchase, dryRun);
        if (result.credited) summary.credited += 1;
        else if (result.rejected) summary.rejected += 1;
        else summary.stillPending += 1;
      } catch (err) {
        summary.errors += 1;
        getLogger().error({ err }, `Reconcile failed for purchase ${purchase.id}:`);
      }
    }

    return summary;
  }

  isDiscrepancy(freshStatus, validation) {
    if (!freshStatus) return false;
    if (freshStatus === 'CREDITED' && (validation.pending || !validation.valid)) return true;
    if (freshStatus === 'REJECTED' && (validation.valid || validation.pending)) return true;
    return false;
  }

  async reconcileOne(purchase, dryRun = false) {
    const validation = await this.paymentProviderService.validatePurchase({
      productId: purchase.productId,
      purchaseToken: purchase.purchaseToken,
      provider: purchase.provider
    });

    if (dryRun) {
      if (validation.valid) return { credited: true };
      if (validation.pending) return { stillPending: true };
      return { rejected: true };
    }

    if (validation.valid) {
      const stickerAmount = this.planService.getStickerCount(purchase.productId);
      if (!stickerAmount) {
        throw new Error(`Unknown productId on purchase ${purchase.id}`);
      }

      let credited = false;
      let discrepancy = false;
      await this.unitOfWork.run(async (repos) => {
        const fresh = await repos.purchase.findById(purchase.id);
        if (!fresh) return;
        if (this.isDiscrepancy(fresh.status, validation)) {
          discrepancy = true;
        }
        if (fresh.status === 'CREDITED') {
          return;
        }

        let balance = await repos.balance.findByUserId(purchase.userId);
        if (!balance) {
          balance = await repos.balance.createForUser(purchase.userId);
        }
        const newBalance = balance.add(stickerAmount);
        await repos.balance.save(balance);

        const transaction = Transaction.createPurchase({
          userId: purchase.userId,
          amount: stickerAmount,
          productId: purchase.productId,
          provider: purchase.provider,
          providerTransactionId: purchase.purchaseToken,
          balanceAfter: newBalance,
          metadata: { status: 'CREDITED', reconciled: true }
        });
        await repos.transaction.save(transaction);

        const updated = new Purchase({
          ...fresh,
          status: 'CREDITED',
          orderId: validation.orderId ?? fresh.orderId,
          transactionId: transaction.id,
          verifiedAt: new Date().toISOString(),
          reconciledAt: new Date().toISOString(),
          reconcileAttempts: (fresh.reconcileAttempts || 0) + 1,
          providerResponse: validation.providerResponse ?? null
        });
        await repos.purchase.save(updated);
        credited = true;
      });

      if (discrepancy) metrics.reconcileDiscrepancy();
      if (credited) metrics.purchaseState('CREDITED');

      return { credited };
    }

    if (validation.pending) {
      let stillPending = false;
      let transitioned = false;
      let discrepancy = false;
      await this.unitOfWork.run(async (repos) => {
        const fresh = await repos.purchase.findById(purchase.id);
        if (!fresh) return;
        if (this.isDiscrepancy(fresh.status, validation)) {
          discrepancy = true;
        }
        if (fresh.status === 'CREDITED' || fresh.status === 'REJECTED') {
          return;
        }
        if (fresh.status === 'PENDING') {
          const updated = new Purchase({
            ...fresh,
            reconciledAt: new Date().toISOString(),
            reconcileAttempts: (fresh.reconcileAttempts || 0) + 1
          });
          await repos.purchase.save(updated);
          stillPending = true;
          return;
        }
        const updated = new Purchase({
          ...fresh,
          status: 'PENDING',
          reconciledAt: new Date().toISOString(),
          reconcileAttempts: (fresh.reconcileAttempts || 0) + 1
        });
        await repos.purchase.save(updated);
        stillPending = true;
        transitioned = true;
      });
      if (discrepancy) metrics.reconcileDiscrepancy();
      if (transitioned) metrics.purchaseState('PENDING');
      return { stillPending };
    }

    let rejected = false;
    let transitioned = false;
    let discrepancy = false;
    await this.unitOfWork.run(async (repos) => {
      const fresh = await repos.purchase.findById(purchase.id);
      if (!fresh) return;
      if (this.isDiscrepancy(fresh.status, validation)) {
        discrepancy = true;
      }
      if (fresh.status === 'CREDITED') {
        return;
      }
      if (fresh.status === 'REJECTED') {
        const updated = new Purchase({
          ...fresh,
          reconciledAt: new Date().toISOString(),
          reconcileAttempts: (fresh.reconcileAttempts || 0) + 1
        });
        await repos.purchase.save(updated);
        rejected = true;
        return;
      }
      const updated = new Purchase({
        ...fresh,
        status: 'REJECTED',
        reconciledAt: new Date().toISOString(),
        reconcileAttempts: (fresh.reconcileAttempts || 0) + 1
      });
      await repos.purchase.save(updated);
      rejected = true;
      transitioned = true;
    });

    if (discrepancy) metrics.reconcileDiscrepancy();
    if (transitioned) metrics.purchaseState('REJECTED');
    return { rejected };
  }

  async updatePendingPurchaseAge() {
    const pending = await this.purchaseRepository.findPendingForReconcile(1);
    if (!pending?.length) {
      metrics.setPendingPurchaseAge(0);
      return 0;
    }
    const oldest = pending[0];
    const ageSeconds = Math.max(0, Math.floor((Date.now() - new Date(oldest.createdAt).getTime()) / 1000));
    metrics.setPendingPurchaseAge(ageSeconds);
    return ageSeconds;
  }
}

import { createHash } from 'node:crypto';
import { Transaction } from '../../../domain/entities/transaction.entity.js';

/**
 * Refund Balance Use Case
 * Compensates a user when a generation job fails after the balance was already spent.
 *
 * Refunds are idempotent per job/cause using a deterministic idempotency key
 * stored as the ledger entry idempotencyKey.
 */
export class RefundBalanceUseCase {
  constructor({ balanceRepository, transactionRepository, unitOfWork }) {
    this.balanceRepository = balanceRepository;
    this.transactionRepository = transactionRepository;
    this.unitOfWork = unitOfWork;
  }

  static refundKey(userId, productId, reason = '', jobId = '') {
    const cause = jobId ? `${userId}:${productId}:job:${jobId}` : `${userId}:${productId}:${reason}`;
    return `refund:${createHash('sha256').update(cause).digest('hex')}`;
  }

  /**
   * Execute refund
   * @param {Object} input
   * @param {string} input.userId - User identifier
   * @param {number} input.amount - Amount to refund
   * @param {string} input.productId - Product/job type that failed
   * @param {string} input.reason - Reason for refund
   * @param {string} [input.jobId] - Durable generation job id
   * @returns {Object} Refund result
   */
  async execute({ userId, amount, productId, reason = '', jobId }) {
    const idempotencyKey = RefundBalanceUseCase.refundKey(userId, productId, reason, jobId);

    const existing = await this.transactionRepository.findByProviderTransactionId(idempotencyKey);
    if (existing) {
      const balance = await this.balanceRepository.findByUserId(userId);
      return {
        success: true,
        amount: existing.amount,
        newBalance: balance?.stickerDollars || 0,
        transactionId: existing.id,
        isDuplicate: true
      };
    }

    return this.unitOfWork.run(async (repos) => {
      const balance = await repos.balance.findByUserId(userId);
      if (!balance) {
        throw new Error('User balance not found');
      }

      balance.refund(amount);
      await repos.balance.save(balance);

      const transaction = Transaction.createRefund({
        userId,
        amount,
        productId,
        balanceAfter: balance.stickerDollars,
        metadata: { reason, idempotencyKey }
      });
      transaction.providerTransactionId = idempotencyKey;
      await repos.transaction.save(transaction);

      return {
        success: true,
        amount,
        newBalance: balance.stickerDollars,
        transactionId: transaction.id,
        isDuplicate: false
      };
    });
  }
}

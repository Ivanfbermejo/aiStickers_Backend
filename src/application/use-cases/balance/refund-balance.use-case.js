import { Transaction } from '../../../domain/entities/transaction.entity.js';

/**
 * Refund Balance Use Case
 * Compensates a user when a generation job fails after the balance was already spent
 */
export class RefundBalanceUseCase {
  constructor({ balanceRepository, transactionRepository }) {
    this.balanceRepository = balanceRepository;
    this.transactionRepository = transactionRepository;
  }

  /**
   * Execute refund
   * @param {Object} input
   * @param {string} input.userId - User identifier
   * @param {number} input.amount - Amount to refund
   * @param {string} input.productId - Product/job type that failed
   * @param {string} input.reason - Reason for refund
   * @returns {Object} Refund result
   */
  async execute({ userId, amount, productId, reason = '' }) {
    const balance = await this.balanceRepository.findByUserId(userId);
    if (!balance) {
      throw new Error('User balance not found');
    }

    balance.refund(amount);
    await this.balanceRepository.save(balance);

    const transaction = Transaction.createRefund({
      userId,
      amount,
      productId,
      balanceAfter: balance.stickerDollars,
      metadata: { reason }
    });
    await this.transactionRepository.save(transaction);

    return {
      success: true,
      amount,
      newBalance: balance.stickerDollars,
      transactionId: transaction.id
    };
  }
}

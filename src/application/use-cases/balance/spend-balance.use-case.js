import { Transaction } from '../../../domain/entities/transaction.entity.js';

/**
 * Spend Balance Use Case
 * Deducts StickerDollars from user balance for sticker generation
 */
export class SpendBalanceUseCase {
  constructor({ balanceRepository, transactionRepository }) {
    this.balanceRepository = balanceRepository;
    this.transactionRepository = transactionRepository;
  }
  
  /**
   * Execute balance spending
   * @param {Object} input
   * @param {string} input.userId - User identifier
   * @param {number} input.amount - Amount to spend
   * @param {string} input.productId - Product being purchased (sticker pack)
   * @returns {Object} Spending result
   */
  async execute({ userId, amount, productId }) {
    // 1. Get user balance
    const balance = await this.balanceRepository.findByUserId(userId);
    
    if (!balance) {
      throw new Error('User balance not found');
    }
    
    // 2. Check sufficient balance
    if (!balance.hasEnough(amount)) {
      throw new Error('Insufficient balance');
    }
    
    // 3. Deduct balance
    balance.spend(amount);
    await this.balanceRepository.save(balance);
    
    // 4. Create spend transaction
    const transaction = Transaction.createSpend({
      userId,
      amount,
      productId,
      balanceAfter: balance.stickerDollars
    });
    await this.transactionRepository.save(transaction);
    
    // 5. Return result
    return {
      success: true,
      amount,
      newBalance: balance.stickerDollars,
      transactionId: transaction.id
    };
  }
}

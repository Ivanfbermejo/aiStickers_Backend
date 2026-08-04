import { Transaction } from '../../../domain/entities/transaction.entity.js';

/**
 * Spend Balance Use Case
 * Deducts StickerDollars from user balance for an authorized server-side operation.
 *
 * The amount is always determined by the server; a caller-supplied amount is
 * rejected if it does not match the catalog cost for the productId.
 */
export class SpendBalanceUseCase {
  constructor({ balanceRepository, transactionRepository, costService, unitOfWork }) {
    this.balanceRepository = balanceRepository;
    this.transactionRepository = transactionRepository;
    this.costService = costService;
    this.unitOfWork = unitOfWork;
  }

  /**
   * Execute balance spending
   * @param {Object} input
   * @param {string} input.userId - User identifier
   * @param {string} input.productId - Server-authorized operation/product
   * @param {number} [input.amount] - Optional amount asserted by an internal caller
   * @returns {Object} Spending result
   */
  async execute({ userId, productId, amount }) {
    const cost = this.costService.getCost(productId);
    if (amount !== undefined && amount !== cost) {
      throw new Error('Amount mismatch: client-provided amounts are not trusted');
    }

    return this.unitOfWork.run(async (repos) => {
      const balance = await repos.balance.findByUserId(userId);
      if (!balance) {
        throw new Error('User balance not found');
      }
      if (!balance.hasEnough(cost)) {
        throw new Error('Insufficient balance');
      }

      balance.spend(cost);
      await repos.balance.save(balance);

      const transaction = Transaction.createSpend({
        userId,
        amount: cost,
        productId,
        balanceAfter: balance.stickerDollars
      });
      await repos.transaction.save(transaction);

      return {
        success: true,
        amount: cost,
        newBalance: balance.stickerDollars,
        transactionId: transaction.id
      };
    });
  }
}

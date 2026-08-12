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

    return this.unitOfWork.run((repos) => this.executeInTransaction({
      repos,
      userId,
      productId,
      amount,
      cost
    }));
  }

  /** Execute the debit using repositories already bound to one DB tx. */
  async executeInTransaction({ repos, userId, productId, amount, cost }) {
    const resolvedCost = cost ?? this.costService.getCost(productId);
    if (amount !== undefined && amount !== resolvedCost) {
      throw new Error('Amount mismatch: client-provided amounts are not trusted');
    }

    const balance = await repos.balance.findByUserId(userId);
    if (!balance) {
      throw new Error('User balance not found');
    }
    if (!balance.hasEnough(resolvedCost)) {
      throw new Error('Insufficient balance');
    }

    balance.spend(resolvedCost);
    await repos.balance.save(balance);

    const transaction = Transaction.createSpend({
      userId,
      amount: resolvedCost,
      productId,
      balanceAfter: balance.stickerDollars
    });
    await repos.transaction.save(transaction);

    return {
      success: true,
      amount: resolvedCost,
      newBalance: balance.stickerDollars,
      transactionId: transaction.id
    };
  }
}

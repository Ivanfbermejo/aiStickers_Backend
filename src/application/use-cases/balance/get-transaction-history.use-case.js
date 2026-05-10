/**
 * Get Transaction History Use Case
 * Retrieves user's transaction history
 */
export class GetTransactionHistoryUseCase {
  constructor({ transactionRepository }) {
    this.transactionRepository = transactionRepository;
  }
  
  /**
   * Execute history retrieval
   * @param {Object} input
   * @param {string} input.userId - User identifier
   * @param {number} input.limit - Max number of transactions
   * @param {number} input.offset - Pagination offset
   * @returns {Object} Transaction history
   */
  async execute({ userId, limit = 50, offset = 0 }) {
    const transactions = await this.transactionRepository.getHistory(
      userId,
      limit,
      offset
    );
    
    return {
      userId,
      transactions: transactions.map(t => t.toJSON()),
      count: transactions.length
    };
  }
}

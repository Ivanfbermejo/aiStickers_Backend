/**
 * Get Balance Use Case
 * Retrieves user balance information
 */
export class GetBalanceUseCase {
  constructor({ balanceRepository }) {
    this.balanceRepository = balanceRepository;
  }
  
  /**
   * Execute balance retrieval
   * @param {Object} input
   * @param {string} input.userId - User identifier
   * @returns {Object} Balance information
   */
  async execute({ userId }) {
    const balance = await this.balanceRepository.findByUserId(userId);
    
    if (!balance) {
      // Return zero balance for new users
      return {
        userId,
        stickerDollars: 0,
        totalPurchased: 0,
        totalSpent: 0
      };
    }
    
    return balance.toJSON();
  }
}

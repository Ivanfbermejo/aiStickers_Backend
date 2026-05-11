import { container } from '../../../config/container.js';

/**
 * Balance Controller
 * Handles balance and transaction endpoints
 */
export class BalanceController {
  /**
   * Get User Balance
   * GET /api/v1/users/balance
   */
  static async getBalance(req, res) {
    try {
      const userId = req.user.sub;
      
      const balance = await container.useCases.getBalance.execute({ userId });
      
      res.json({
        success: true,
        balance: balance.stickerDollars,
        totalPurchased: balance.totalPurchased,
        totalSpent: balance.totalSpent
      });
    } catch (error) {
      console.error('Get balance failed:', error);
      res.status(500).json({
        error: 'Failed to retrieve balance',
        message: error.message
      });
    }
  }
  
  /**
   * Spend Balance
   * POST /api/v1/users/balance/spend
   */
  static async spendBalance(req, res) {
    try {
      const { amount, productId } = req.body;
      const userId = req.user.sub;
      
      if (!amount || amount <= 0) {
        return res.status(400).json({
          error: 'Invalid amount',
          message: 'Amount must be positive number'
        });
      }
      
      const result = await container.useCases.spendBalance.execute({
        userId,
        amount,
        productId
      });
      
      res.json({
        success: true,
        amount: result.amount,
        newBalance: result.newBalance,
        transactionId: result.transactionId
      });
    } catch (error) {
      console.error('Spend balance failed:', error);
      
      if (error.message === 'Insufficient balance') {
        return res.status(400).json({
          error: 'Insufficient balance',
          message: 'Not enough StickerDollars'
        });
      }
      
      res.status(500).json({
        error: 'Transaction failed',
        message: error.message
      });
    }
  }
  
  /**
   * Get Transaction History
   * GET /api/v1/users/balance/history
   */
  static async getTransactionHistory(req, res) {
    try {
      const userId = req.user.sub;
      const limit = parseInt(req.query.limit) || 50;
      
      const history = await container.useCases.getTransactionHistory.execute({
        userId,
        limit
      });
      
      res.json({
        success: true,
        userId: history.userId,
        transactions: history.transactions,
        count: history.count
      });
    } catch (error) {
      console.error('Get transaction history failed:', error);
      res.status(500).json({
        error: 'Failed to retrieve history',
        message: error.message
      });
    }
  }
  
  /**
   * Get User Assets (Balance + Stickers + Packages)
   * GET /api/v1/users/me/assets
   */
  static async getUserAssets(req, res) {
    try {
      const userId = req.user.sub;
      
      const balance = await container.useCases.getBalance.execute({ userId });
      
      res.json({
        success: true,
        userId: userId,
        balance: balance.stickerDollars,
        stickers: [], // TODO: Implement sticker inventory
        packages: []  // TODO: Implement purchased packages
      });
    } catch (error) {
      console.error('Get user assets failed:', error);
      res.status(500).json({
        error: 'Failed to retrieve assets',
        message: error.message
      });
    }
  }
}

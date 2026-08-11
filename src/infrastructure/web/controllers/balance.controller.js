import { container } from '../../../config/container.js';
import { getLogger } from '../../observability/logger.js';

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
      getLogger().error({ err: error }, 'Get balance failed:');
      res.status(500).json({
        error: 'Failed to retrieve balance',
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

      const response = {
        success: true,
        userId: history.userId,
        transactions: history.transactions,
        count: history.count
      };
      res.json(response);
    } catch (error) {
      getLogger().error({ err: error }, 'Get transaction history failed:');
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

      const response = {
        success: true,
        userId: userId,
        balance: balance.stickerDollars,
        stickers: [], // TODO: Implement sticker inventory
        packages: []  // TODO: Implement purchased packages
      };

      res.json(response);
    } catch (error) {
      getLogger().error({ err: error }, 'Get user assets failed:');
      res.status(500).json({
        error: 'Failed to retrieve assets',
        message: error.message
      });
    }
  }
}

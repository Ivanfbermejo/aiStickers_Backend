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
   * Get Transaction History
   * GET /api/v1/users/balance/history
   */
  static async getTransactionHistory(req, res) {
    console.log('🔍 getTransactionHistory called');
    try {
      const userId = req.user.sub;
      console.log('🔍 userId:', userId);
      const limit = parseInt(req.query.limit) || 50;
      console.log('🔍 limit:', limit);
      
      console.log('🔍 Getting transaction history...');
      const history = await container.useCases.getTransactionHistory.execute({
        userId,
        limit
      });
      console.log('🔍 History result:', history);
      
      const response = {
        success: true,
        userId: history.userId,
        transactions: history.transactions,
        count: history.count
      };
      console.log('🔍 Sending history response:', response);
      res.json(response);
    } catch (error) {
      console.error('❌ Get transaction history failed:', error);
      console.error('❌ Error stack:', error.stack);
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
    console.log('� getUserAssets HIT!!!');
    try {
      const userId = req.user.sub;
      console.log('🔍 userId:', userId);
      
      console.log('🔍 Getting balance...');
      const balance = await container.useCases.getBalance.execute({ userId });
      console.log('🔍 Balance result:', balance);
      
      const response = {
        success: true,
        userId: userId,
        balance: balance.stickerDollars,
        stickers: [], // TODO: Implement sticker inventory
        packages: []  // TODO: Implement purchased packages
      };
      
      console.log('🔍 Sending response:', response);
      res.json(response);
    } catch (error) {
      console.error('❌ Get user assets failed:', error);
      console.error('❌ Error stack:', error.stack);
      res.status(500).json({
        error: 'Failed to retrieve assets',
        message: error.message
      });
    }
  }
}

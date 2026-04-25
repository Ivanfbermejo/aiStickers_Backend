import { BalanceService } from "../services/balance.simple.service.js";

/**
 * Controller para operaciones de balance StickerDollars
 * Maneja endpoints de consulta y gasto de balance
 */

export const BalanceController = {
  
  /**
   * GET /api/v1/users/balance
   * Obtiene el balance actual del usuario autenticado
   */
  async getBalance(req, res) {
    const userId = req.user?.sub;
    
    if (!userId) {
      return res.status(401).json({ success: false, error: "User not authenticated" });
    }
    
    try {
      const balance = await BalanceService.getBalance(userId);
      const stats = await BalanceService.getUserStats(userId);
      
      res.json({
        success: true,
        userId,
        balance,
        stats: stats || {
          sticker_dollars: balance,
          total_purchased: 0,
          total_spent: 0
        }
      });
    } catch (error) {
      console.error("❌ [BalanceController] Error getting balance:", error.message);
      res.status(500).json({ success: false, error: "Failed to get balance" });
    }
  },

  /**
   * POST /api/v1/users/balance/spend
   * Gasta StickerDollars (cuando usuario genera imagen)
   */
  async spendBalance(req, res) {
    const userId = req.user?.sub;
    const { amount = 1 } = req.body;
    
    if (!userId) {
      return res.status(401).json({ success: false, error: "User not authenticated" });
    }
    
    try {
      const result = await BalanceService.spendBalance(userId, amount);
      
      if (!result.success) {
        return res.status(400).json({
          success: false,
          error: result.error,
          message: result.message,
          required: amount,
          currentBalance: result.currentBalance
        });
      }
      
      res.json({
        success: true,
        userId,
        spent: amount,
        balance: result.balance,
        transactionId: result.transactionId
      });
    } catch (error) {
      console.error("❌ [BalanceController] Error spending balance:", error.message);
      res.status(500).json({ success: false, error: "Failed to spend balance" });
    }
  },

  /**
   * GET /api/v1/users/balance/history
   * Obtiene historial de transacciones del usuario
   */
  async getTransactionHistory(req, res) {
    const userId = req.user?.sub;
    const limit = parseInt(req.query.limit) || 50;
    
    if (!userId) {
      return res.status(401).json({ success: false, error: "User not authenticated" });
    }
    
    try {
      const history = await BalanceService.getTransactionHistory(userId, limit);
      
      res.json({
        success: true,
        userId,
        transactions: history,
        count: history.length
      });
    } catch (error) {
      console.error("❌ [BalanceController] Error getting history:", error.message);
      res.status(500).json({ success: false, error: "Failed to get transaction history" });
    }
  }
};

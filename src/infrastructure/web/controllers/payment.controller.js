import { container } from '../../../config/container.js';

/**
 * Payment Controller
 * Handles payment validation endpoints
 */
export class PaymentController {
  /**
   * Validate Google Play Purchase
   * POST /api/v1/payments/validate/google-play
   */
  static async validateGooglePlayPurchase(req, res) {
    try {
      const { productId, purchaseToken } = req.body;
      const userId = req.user.sub;
      
      if (!productId || !purchaseToken) {
        return res.status(400).json({
          error: 'Missing parameters',
          message: 'productId and purchaseToken are required'
        });
      }
      
      const result = await container.useCases.validatePurchase.execute({
        userId,
        productId,
        purchaseToken,
        provider: 'GOOGLE_PLAY'
      });

      if (result.pending) {
        return res.json({
          success: false,
          pending: true,
          transactionId: result.transactionId,
          amount: result.amount,
          newBalance: result.newBalance,
          message: result.message
        });
      }
      
      res.json({
        success: true,
        transactionId: result.transactionId,
        amount: result.amount,
        newBalance: result.newBalance,
        isDuplicate: result.isDuplicate,
        fraudFlags: result.fraudFlags,
        riskScore: result.riskScore
      });
    } catch (error) {
      console.error('Purchase validation failed:', error);
      res.status(400).json({
        success: false,
        error: error.message
      });
    }
  }
  
  /**
   * Validate Apple App Store Purchase
   * POST /api/v1/payments/validate/apple-app-store
   */
  static async validateApplePurchase(req, res) {
    try {
      const { productId, receipt } = req.body;
      const userId = req.user.sub;
      
      if (!productId || !receipt) {
        return res.status(400).json({
          error: 'Missing parameters',
          message: 'productId and receipt are required'
        });
      }
      
      const result = await container.useCases.validatePurchase.execute({
        userId,
        productId,
        purchaseToken: receipt,
        provider: 'APPLE_APP_STORE'
      });
      
      res.json({
        success: true,
        transactionId: result.transactionId,
        amount: result.amount,
        newBalance: result.newBalance,
        isDuplicate: result.isDuplicate,
        fraudFlags: result.fraudFlags,
        riskScore: result.riskScore
      });
    } catch (error) {
      console.error('Apple purchase validation failed:', error);
      res.status(400).json({
        success: false,
        error: error.message
      });
    }
  }
}

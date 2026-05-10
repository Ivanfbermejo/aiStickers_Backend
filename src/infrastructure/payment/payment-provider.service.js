import { GooglePlayPaymentService } from './google-play.service.js';

/**
 * Payment Provider Service
 * Unified interface for different payment providers
 */
export class PaymentProviderService {
  constructor() {
    this.googlePlayService = new GooglePlayPaymentService();
  }
  
  /**
   * Validate purchase with appropriate provider
   * @param {Object} params
   * @param {string} params.productId
   * @param {string} params.purchaseToken
   * @param {string} params.provider - 'GOOGLE_PLAY' or 'APPLE_APP_STORE'
   * @returns {Object} Validation result
   */
  async validatePurchase({ productId, purchaseToken, provider }) {
    switch (provider) {
      case 'GOOGLE_PLAY':
        return this.googlePlayService.validatePurchase({
          productId,
          purchaseToken
        });
      
      case 'APPLE_APP_STORE':
        // Apple validation not implemented yet
        console.warn('Apple App Store validation not implemented');
        return {
          valid: true, // Accept for now
          message: 'Apple validation not implemented'
        };
      
      default:
        throw new Error(`Unknown payment provider: ${provider}`);
    }
  }
}

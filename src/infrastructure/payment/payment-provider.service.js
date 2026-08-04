import { env } from '../../config/env.js';
import { GooglePlayPaymentService } from './google-play.service.js';

/**
 * Payment Provider Service
 * Unified interface for different payment providers.
 *
 * Apple App Store payments remain disabled for the Android scope. They will be
 * wired to the App Store Server API / notifications in a future task.
 */
export class PaymentProviderService {
  constructor({ googlePlayService = null } = {}) {
    this.googlePlayService = googlePlayService || new GooglePlayPaymentService();
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
        // Apple is intentionally disabled until App Store Server API is implemented.
        console.warn('Apple App Store validation rejected: feature flag is off');
        return {
          valid: false,
          pending: false,
          error: env.ENABLE_APPLE_PAYMENTS
            ? 'Apple App Store validation not fully implemented'
            : 'Apple App Store payments are disabled'
        };

      default:
        throw new Error(`Unknown payment provider: ${provider}`);
    }
  }
}

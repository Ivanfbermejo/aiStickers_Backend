import { google } from 'googleapis';
import { env } from '../../config/env.js';

/**
 * Google Play Payment Provider Service
 * Validates purchases with Google Play API
 */
export class GooglePlayPaymentService {
  constructor() {
    this.androidPublisher = null;
    this.packageName = env.GOOGLE_PACKAGE_NAME || 'com.animatedsticker.aistickers';
    this.initialize();
  }
  
  initialize() {
    try {
      // Note: Requires Google Play Service Account credentials
      // For now, we simulate validation in test mode
      this.isTestMode = !env.GOOGLE_PLAY_SERVICE_ACCOUNT;
      
      if (!this.isTestMode) {
        const auth = new google.auth.GoogleAuth({
          credentials: JSON.parse(env.GOOGLE_PLAY_SERVICE_ACCOUNT),
          scopes: ['https://www.googleapis.com/auth/androidpublisher']
        });
        
        this.androidPublisher = google.androidpublisher({
          version: 'v3',
          auth
        });
      }
    } catch (error) {
      console.warn('Google Play service initialization failed, using test mode:', error.message);
      this.isTestMode = true;
    }
  }
  
  /**
   * Validate purchase with Google Play
   * @param {Object} params
   * @param {string} params.productId - Product ID
   * @param {string} params.purchaseToken - Purchase token
   * @returns {Object} Validation result
   */
  async validatePurchase({ productId, purchaseToken }) {
    // Test mode - accept all purchases (for development)
    if (this.isTestMode) {
      console.log(`[GooglePlay] Test mode: Accepting purchase ${productId}`);
      return {
        valid: true,
        purchaseState: 0, // PURCHASED
        consumptionState: 0, // NOT_CONSUMED
        acknowledgementState: 0 // NOT_ACKNOWLEDGED
      };
    }
    
    try {
      const response = await this.androidPublisher.purchases.products.get({
        packageName: this.packageName,
        productId,
        token: purchaseToken
      });
      
      const purchase = response.data;
      
      return {
        valid: purchase.purchaseState === 0, // 0 = PURCHASED
        purchaseState: purchase.purchaseState,
        consumptionState: purchase.consumptionState,
        acknowledgementState: purchase.acknowledgementState,
        orderId: purchase.orderId
      };
    } catch (error) {
      console.error('Google Play validation failed:', error);
      return {
        valid: false,
        error: error.message
      };
    }
  }
}

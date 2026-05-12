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
    // Test mode — GOOGLE_PLAY_SERVICE_ACCOUNT not configured.
    // Cannot verify real purchase state with Google Play API.
    // Return pending=true so balance is NOT credited until real validation is possible.
    if (this.isTestMode) {
      console.warn(`[GooglePlay] ⚠️ No service account configured — cannot validate purchase ${productId}. Returning pending.`);
      return {
        valid: false,
        pending: true,
        error: 'Google Play validation pending: GOOGLE_PLAY_SERVICE_ACCOUNT not configured'
      };
    }
    
    try {
      const response = await this.androidPublisher.purchases.products.get({
        packageName: this.packageName,
        productId,
        token: purchaseToken
      });
      
      const purchase = response.data;
      const isPurchased = purchase.purchaseState === 0; // 0 = PURCHASED, 2 = PENDING
      
      console.log(`[GooglePlay] Purchase ${productId} state=${purchase.purchaseState} orderId=${purchase.orderId}`);
      
      if (!isPurchased) {
        return {
          valid: false,
          pending: purchase.purchaseState === 2,
          purchaseState: purchase.purchaseState,
          error: `Purchase not completed. State: ${purchase.purchaseState}`
        };
      }

      return {
        valid: true,
        purchaseState: purchase.purchaseState,
        consumptionState: purchase.consumptionState,
        acknowledgementState: purchase.acknowledgementState,
        orderId: purchase.orderId
      };
    } catch (error) {
      const status = error?.response?.status;
      const isNotFound = status === 404;
      const isDebugBuild = error?.message?.includes('invalid') || isNotFound;
      
      console.error(`[GooglePlay] Validation error (status=${status}): ${error.message}`);
      
      // 404 = token not found in GP servers = debug/sideloaded build
      // Treat as pending so balance is not credited but purchase is not lost
      if (isDebugBuild) {
        console.warn(`[GooglePlay] ⚠️ Token not found in Google Play — likely a debug/sideloaded build. Treating as pending.`);
        return {
          valid: false,
          pending: true,
          error: 'Purchase token not found in Google Play (debug build?)'
        };
      }
      
      return {
        valid: false,
        pending: false,
        error: error.message
      };
    }
  }
}

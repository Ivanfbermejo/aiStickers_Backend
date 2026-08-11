import { google } from 'googleapis';
import { env } from '../../config/env.js';
import { getLogger } from '../observability/logger.js';
import { metrics } from '../observability/metrics.js';

/**
 * Google Play Payment Provider Service
 * Validates purchases with the Google Play Android Publisher API.
 *
 * The Android Publisher client can be injected for testing so no real service
 * account credentials are required in unit/integration tests.
 */
export class GooglePlayPaymentService {
  constructor({ androidPublisher = null, packageName = null } = {}) {
    this.androidPublisher = androidPublisher;
    this.packageName = packageName || env.GOOGLE_PACKAGE_NAME || 'com.animatedsticker.aistickers';
    this.isTestMode = !this.androidPublisher && !env.GOOGLE_PLAY_SERVICE_ACCOUNT;

    if (!this.androidPublisher && env.GOOGLE_PLAY_SERVICE_ACCOUNT) {
      this.initialize();
    }
  }

  initialize() {
    try {
      const auth = new google.auth.GoogleAuth({
        credentials: JSON.parse(env.GOOGLE_PLAY_SERVICE_ACCOUNT),
        scopes: ['https://www.googleapis.com/auth/androidpublisher']
      });

      this.androidPublisher = google.androidpublisher({
        version: 'v3',
        auth
      });
    } catch (error) {
      getLogger().warn({ err: error }, 'Google Play service initialization failed, using test mode:');
      this.androidPublisher = null;
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
    if (!productId || typeof productId !== 'string') {
      return { valid: false, pending: false, error: 'Missing productId' };
    }
    if (!purchaseToken || typeof purchaseToken !== 'string') {
      return { valid: false, pending: false, error: 'Missing purchaseToken' };
    }

    // Test mode — no service account configured and no injected client.
    // Cannot verify the real purchase state, so we treat it as pending.
    if (this.isTestMode || !this.androidPublisher) {
      getLogger().warn('[GooglePlay] No Android Publisher client configured — purchase validation pending.');
      return {
        valid: false,
        pending: true,
        error: 'Google Play validation pending: no Android Publisher client configured'
      };
    }

    try {
      const response = await this.androidPublisher.purchases.products.get({
        packageName: this.packageName,
        productId,
        token: purchaseToken
      });

      const purchase = response.data;
      const purchaseState = purchase.purchaseState;
      const orderId = purchase.orderId;

      if (purchaseState === undefined || purchaseState === null) {
        return {
          valid: false,
          pending: false,
          error: 'Invalid Google Play response: missing purchaseState'
        };
      }

      if (!orderId) {
        return {
          valid: false,
          pending: false,
          error: 'Invalid Google Play response: missing orderId'
        };
      }

      const isPurchased = purchaseState === 0; // 0 = PURCHASED
      const isPending = purchaseState === 2; // 2 = PENDING

      if (!isPurchased) {
        return {
          valid: false,
          pending: isPending,
          purchaseState,
          error: `Purchase not completed. State: ${purchaseState}`
        };
      }

      return {
        valid: true,
        purchaseState,
        orderId,
        providerResponse: {
          consumptionState: purchase.consumptionState,
          acknowledgementState: purchase.acknowledgementState
        }
      };
    } catch (error) {
      const status = error?.response?.status;
      const isNotFound = status === 404;

      getLogger().error(`[GooglePlay] Validation error (status=${status})`);

      if (isNotFound) {
        return {
          valid: false,
          pending: false,
          error: 'Purchase token not found in Google Play'
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

import { env } from '../../../config/env.js';

/**
 * Config Controller
 * Handles public configuration endpoints
 */
export class ConfigController {
  /**
   * Get Public Config
   * GET /api/v1/config
   */
  static async getConfig(req, res) {
    res.json({
      minVersion: '0.0.9',
      forceUpdate: false,
      storeUrl: {
        android: 'https://play.google.com/store/apps/details?id=com.animatedsticker.aistickers',
        ios: 'https://apps.apple.com/app/id000000000'
      },
      features: {
        googleAuth: true,
        appleAuth: false,
        payment: true
      }
    });
  }
}

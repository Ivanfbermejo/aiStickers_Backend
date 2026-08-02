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
        android: 'https://play.google.com/store/apps/details?id=com.animatedsticker.aistickers'
      },
      features: {
        googleAuth: Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET),
        appleAuth: env.ENABLE_APPLE_PAYMENTS,
        payment: true,
        telegram: env.ENABLE_TELEGRAM,
        whatsappExport: env.ENABLE_WHATSAPP_EXPORT,
        externalImageUrls: env.ENABLE_EXTERNAL_IMAGE_URLS
      }
    });
  }
}

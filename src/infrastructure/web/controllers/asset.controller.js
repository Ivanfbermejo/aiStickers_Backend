import { container } from '../../../config/container.js';
import { getLogger } from '../../observability/logger.js';

/**
 * Asset Controller
 *
 * Streams private assets via authenticated access or short-lived signed token.
 * Never exposes permanent URLs.
 */
export class AssetController {
  static async getAsset(req, res) {
    try {
      const userId = req.user?.sub;
      const key = req.params[0];
      const token = req.query?.token;

      if (!key) {
        return res.status(400).json({ error: 'Asset key is required' });
      }

      await container.services.asset.streamToResponse({
        key,
        ownerId: userId,
        token,
        res
      });
    } catch (error) {
      getLogger().error({ err: error }, '[AssetController] getAsset error:');
      const status = error.message?.includes('does not belong') || error.message?.includes('Invalid or expired')
        ? 403
        : 404;
      return res.status(status).json({ error: 'Asset not found or access denied' });
    }
  }
}

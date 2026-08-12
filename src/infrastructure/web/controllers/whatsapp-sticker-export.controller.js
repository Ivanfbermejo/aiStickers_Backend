/**
 * WhatsAppStickerExportController
 *
 * Handles HTTP routes for exporting stickers and packs to WhatsApp.
 * All endpoints require HMAC + User JWT.
 *
 * Routes (registered in index.js):
 *   POST /api/v1/stickers/:id/export/whatsapp
 *   GET  /api/v1/stickers/:id/export/whatsapp
 *   POST /api/v1/packages/:id/export/whatsapp
 *   GET  /api/v1/packages/:id/export/whatsapp
 */

import { container } from '../../../config/container.js';
import { getLogger } from '../../observability/logger.js';
import * as WhatsAppService from '../../../application/services/whatsapp-sticker-export.service.js';

export const WhatsAppStickerExportController = {

  /**
   * POST /api/v1/stickers/:id/export/whatsapp
   */
  async exportSticker(req, res) {
    try {
      const userId = req.user?.sub;
      const { id } = req.params;

      if (!userId) {
        return res.status(401).json({ error: 'Unauthorized', message: 'User ID not found in token' });
      }

      const sticker = await container.repositories.sticker.findById(id, userId);
      if (!sticker) {
        return res.status(404).json({ error: 'Sticker not found' });
      }

      if (!sticker.objectKey && !sticker.imageUrl) {
        return res.status(400).json({ error: 'Sticker has no image to export' });
      }

      sticker.markExportProcessing();
      await container.repositories.sticker.update(sticker, userId);

      try {
        const result = await WhatsAppService.exportSticker(
          sticker.objectKey ? { objectKey: sticker.objectKey } : sticker.imageUrl,
          container.services.asset,
          userId,
          `whatsapp-sticker:${sticker.id}:${sticker.objectHash || 'legacy'}`
        );
        sticker.markExportReady(result);
        await container.repositories.sticker.update(sticker, userId);

        return res.status(200).json({
          success: true,
          sticker: {
            id: sticker.id,
            whatsappWebpUrl: result.whatsappWebpUrl,
            width: sticker.width,
            height: sticker.height,
            durationMs: sticker.durationMs,
            sizeBytes: sticker.sizeBytes,
            mimeType: sticker.mimeType,
            exportStatus: sticker.exportStatus
          }
        });
      } catch (err) {
        sticker.markExportFailed(err.message);
        await container.repositories.sticker.update(sticker, userId);
        throw err;
      }
    } catch (err) {
      getLogger().error({ err }, '[WhatsAppStickerExportController] exportSticker error:');
      return res.status(500).json({ error: 'Failed to export sticker to WhatsApp', message: err.message });
    }
  },

  /**
   * GET /api/v1/stickers/:id/export/whatsapp
   */
  async getStickerExportStatus(req, res) {
    try {
      const userId = req.user?.sub;
      const { id } = req.params;

      if (!userId) {
        return res.status(401).json({ error: 'Unauthorized', message: 'User ID not found in token' });
      }

      const sticker = await container.repositories.sticker.findById(id, userId);
      if (!sticker) {
        return res.status(404).json({ error: 'Sticker not found' });
      }

      let validation = null;
      if (sticker.whatsappObjectKey) {
        validation = await WhatsAppService.validateSticker(
          sticker.whatsappObjectKey,
          container.services.asset,
          userId
        );
      }

      return res.status(200).json({
        success: true,
        sticker: {
          id: sticker.id,
          whatsappWebpUrl: sticker.whatsappObjectKey
            ? await container.services.asset.getSignedUrl(sticker.whatsappObjectKey, userId)
            : null,
          width: sticker.width,
          height: sticker.height,
          durationMs: sticker.durationMs,
          sizeBytes: sticker.sizeBytes,
          mimeType: sticker.mimeType,
          exportStatus: sticker.exportStatus,
          exportError: sticker.exportError,
          validation
        }
      });
    } catch (err) {
      getLogger().error({ err }, '[WhatsAppStickerExportController] getStickerExportStatus error:');
      return res.status(500).json({ error: 'Failed to get sticker export status', message: err.message });
    }
  },

  /**
   * POST /api/v1/packages/:id/export/whatsapp
   */
  async exportPackage(req, res) {
    try {
      const userId = req.user?.sub;
      const { id } = req.params;

      if (!userId) {
        return res.status(401).json({ error: 'Unauthorized', message: 'User ID not found in token' });
      }

      const pkg = await container.repositories.package.findById(id, userId);
      if (!pkg) {
        return res.status(404).json({ error: 'Package not found' });
      }

      const stickers = await container.repositories.sticker.findByPackageId(id, userId);
      if (stickers.length === 0) {
        return res.status(400).json({ error: 'Package has no stickers' });
      }

      pkg.markExportProcessing();
      await container.repositories.package.update(pkg, userId);

      try {
        const result = await WhatsAppService.exportPack({
          stickers: stickers.map(s => ({
            id: s.id,
            objectKey: s.objectKey,
            objectHash: s.objectHash,
            imageUrl: s.imageUrl,
            animatedWebpUrl: s.animatedWebpUrl
          })),
          sourceUrl: pkg.icon || (stickers[0].objectKey
            ? { objectKey: stickers[0].objectKey }
            : stickers[0].imageUrl),
          assetService: container.services.asset,
          ownerId: userId,
          idempotencyKey: `whatsapp-tray:${pkg.id}:${stickers[0].objectHash || 'legacy'}`
        });

        pkg.markExportReady({
          trayIconObjectKey: result.trayIconObjectKey,
          trayIconObjectHash: result.trayIconObjectHash,
          trayIconObjectSize: result.trayIconObjectSize,
          trayIconObjectMime: result.trayIconObjectMime,
          trayIconObjectWidth: result.trayIconObjectWidth,
          trayIconObjectHeight: result.trayIconObjectHeight,
          whatsappReady: result.whatsappReady
        });
        pkg.packType = result.packType;
        await container.repositories.package.update(pkg, userId);

        // Persist per-sticker export results where available.
        for (const stickerResult of result.stickerResults) {
          if (stickerResult.error) continue;
          const sticker = stickers.find(s => s.id === stickerResult.id);
          if (sticker) {
            sticker.markExportReady(stickerResult);
            await container.repositories.sticker.update(sticker, userId);
          }
        }

        return res.status(200).json({
          success: true,
          package: {
            id: pkg.id,
            trayIconUrl: result.trayIconUrl,
            packType: pkg.packType,
            whatsappReady: pkg.whatsappReady,
            exportStatus: pkg.exportStatus,
            exportError: pkg.exportError,
            stickerCount: result.stickerResults.length,
            stickerResults: result.stickerResults
          }
        });
      } catch (err) {
        pkg.markExportFailed(err.message);
        await container.repositories.package.update(pkg, userId);
        throw err;
      }
    } catch (err) {
      getLogger().error({ err }, '[WhatsAppStickerExportController] exportPackage error:');
      return res.status(500).json({ error: 'Failed to export package to WhatsApp', message: err.message });
    }
  },

  /**
   * GET /api/v1/packages/:id/export/whatsapp
   */
  async getPackageExportStatus(req, res) {
    try {
      const userId = req.user?.sub;
      const { id } = req.params;

      if (!userId) {
        return res.status(401).json({ error: 'Unauthorized', message: 'User ID not found in token' });
      }

      const pkg = await container.repositories.package.findById(id, userId);
      if (!pkg) {
        return res.status(404).json({ error: 'Package not found' });
      }

      const stickers = await container.repositories.sticker.findByPackageId(id, userId);
      let trayValidation = null;
      if (pkg.trayIconObjectKey) {
        trayValidation = await WhatsAppService.validateTrayIcon(
          pkg.trayIconObjectKey,
          container.services.asset,
          userId
        );
      }

      const stickerValidations = [];
      for (const sticker of stickers) {
        if (sticker.whatsappObjectKey) {
          stickerValidations.push({
            id: sticker.id,
            ...(await WhatsAppService.validateSticker(
              sticker.whatsappObjectKey,
              container.services.asset,
              userId
            ))
          });
        }
      }

      return res.status(200).json({
        success: true,
        package: {
          id: pkg.id,
          trayIconUrl: pkg.trayIconObjectKey
            ? await container.services.asset.getSignedUrl(pkg.trayIconObjectKey, userId)
            : null,
          packType: pkg.packType,
          whatsappReady: pkg.whatsappReady,
          exportStatus: pkg.exportStatus,
          exportError: pkg.exportError,
          stickerCount: stickers.length,
          trayValidation,
          stickerValidations
        }
      });
    } catch (err) {
      getLogger().error({ err }, '[WhatsAppStickerExportController] getPackageExportStatus error:');
      return res.status(500).json({ error: 'Failed to get package export status', message: err.message });
    }
  }
};

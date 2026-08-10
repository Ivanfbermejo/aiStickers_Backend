import { container } from '../../../config/container.js';
import { TelegramPackLink } from '../../../domain/entities/telegram-pack-link.entity.js';
import * as TelegramService from '../../../application/services/telegram.service.js';

function userIdFromRequest(req) {
  return req.user?.sub;
}

function requireUser(req, res) {
  const userId = userIdFromRequest(req);
  if (!userId) {
    res.status(401).json({ error: 'Unauthorized', message: 'User ID not found in token' });
    return null;
  }
  return userId;
}

async function resolvePackageAndStickers({ userId, packageId, stickerIds }) {
  const pkg = await container.repositories.package.findById(packageId, userId);
  if (!pkg) {
    const error = new Error('Package does not exist or does not belong to user');
    error.statusCode = 404;
    throw error;
  }
  if (!Array.isArray(stickerIds) || stickerIds.length === 0) {
    const error = new Error('sticker_ids must contain at least one local sticker ID');
    error.statusCode = 400;
    throw error;
  }

  const uniqueIds = [...new Set(stickerIds)];
  if (uniqueIds.some(id => typeof id !== 'string' || id.trim() === '')) {
    const error = new Error('sticker_ids must contain only local sticker IDs');
    error.statusCode = 400;
    throw error;
  }
  const packageStickers = await container.repositories.sticker.findByPackageId(packageId, userId);
  const byId = new Map(packageStickers.map(sticker => [sticker.id, sticker]));
  const stickers = uniqueIds.map(id => byId.get(id));
  if (stickers.some(sticker => !sticker)) {
    const error = new Error('One or more stickers do not belong to this user and package');
    error.statusCode = 404;
    throw error;
  }
  if (stickers.some(sticker => !sticker.objectKey)) {
    const error = new Error('All Telegram stickers must be stored private assets');
    error.statusCode = 400;
    throw error;
  }

  const references = await Promise.all(stickers.map(sticker =>
    container.services.asset.getSignedUrl(sticker.objectKey, userId)
  ));
  return { pkg, stickers, references };
}

function sendError(res, error, fallback) {
  const status = error.statusCode || (error.message.includes('temporarily disabled') ? 503 : 502);
  return res.status(status).json({ error: fallback, message: error.message });
}

export const TelegramController = {
  /**
   * POST /api/v1/telegram/export-pack
   * Body: { package_id, sticker_ids, telegram_auth }
   * Telegram URLs, pack names and file IDs are deliberately not accepted.
   */
  async exportPack(req, res) {
    try {
      const userId = requireUser(req, res);
      if (!userId) return;
      const { package_id: packageId, sticker_ids: stickerIds, telegram_auth: telegramAuth } = req.body || {};
      if (!packageId || !telegramAuth) {
        return res.status(400).json({ error: 'package_id, sticker_ids and telegram_auth are required' });
      }
      if (
        Object.prototype.hasOwnProperty.call(req.body || {}, 'sticker_urls') ||
        Object.prototype.hasOwnProperty.call(req.body || {}, 'pack_name') ||
        Object.prototype.hasOwnProperty.call(req.body || {}, 'file_ids')
      ) {
        return res.status(400).json({ error: 'Telegram URLs, pack names and file IDs are server-controlled' });
      }

      const telegramIdentity = TelegramService.verifyTelegramLogin(telegramAuth);
      const { pkg, stickers, references } = await resolvePackageAndStickers({ userId, packageId, stickerIds });
      const botUsername = await TelegramService.getBotUsername();
      const setName = TelegramService.deriveSetName({ packageId, botUsername });

      let link = await container.repositories.telegramPackLink.findByUserIdAndPackageId(userId, packageId);
      if (link) {
        if (link.telegramUserId !== telegramIdentity.telegramUserId) {
          return res.status(403).json({ error: 'Telegram link belongs to another Telegram account' });
        }
        if (link.status === 'active') {
          const status = await TelegramService.getPackStatus({ setName: link.setName });
          return res.status(200).json({
            set_name: link.setName,
            add_sticker_url: status.addStickerUrl,
            sticker_count: status.stickerCount
          });
        }
        if (link.status === 'pending') {
          // Recover a prior attempt where the remote set may already exist.
          try {
            const status = await TelegramService.getPackStatus({ setName: link.setName });
            link.markActive();
            await container.repositories.telegramPackLink.update(link, userId);
            return res.status(200).json({
              set_name: link.setName,
              add_sticker_url: status.addStickerUrl,
              sticker_count: status.stickerCount
            });
          } catch {
            // Remote set does not exist yet; continue to create it below.
          }
        }
      }

      if (!link) {
        link = TelegramPackLink.create({
          userId,
          telegramUserId: telegramIdentity.telegramUserId,
          packageId,
          setName,
          stickerFileIds: {}
        });
        await container.repositories.telegramPackLink.save(link);
      }

      let result;
      try {
        result = await TelegramService.exportPack({
          telegramUserId: telegramIdentity.telegramUserId,
          setName,
          packTitle: pkg.name,
          stickerReferences: references
        });
      } catch (error) {
        link.markFailed();
        await container.repositories.telegramPackLink.update(link, userId);
        throw error;
      }

      const stickerFileIds = {};
      for (let index = 0; index < stickers.length; index += 1) {
        const fileId = result.stickers[index]?.file_id;
        if (fileId) stickerFileIds[stickers[index].id] = fileId;
      }
      link.setStickerFileIds(stickerFileIds);
      link.markActive();
      await container.repositories.telegramPackLink.update(link, userId);

      return res.status(201).json({
        set_name: result.setName,
        add_sticker_url: result.addStickerUrl,
        sticker_count: result.stickerCount
      });
    } catch (error) {
      console.error('[TelegramController] exportPack error:', error.message);
      return sendError(res, error, 'Failed to export sticker pack to Telegram');
    }
  },

  /**
   * POST /api/v1/telegram/reconcile-pack
   * Body: { package_id, sticker_ids_to_add, sticker_ids_to_remove }
   * The linked set and Telegram file IDs are loaded from the server.
   */
  async reconcilePack(req, res) {
    try {
      const userId = requireUser(req, res);
      if (!userId) return;
      const {
        package_id: packageId,
        sticker_ids_to_add: stickerIdsToAdd = [],
        sticker_ids_to_remove: stickerIdsToRemove = [],
        file_ids
      } = req.body || {};
      if (file_ids !== undefined) {
        return res.status(400).json({ error: 'Telegram file IDs are server-controlled' });
      }
      if (!packageId || !Array.isArray(stickerIdsToAdd) || !Array.isArray(stickerIdsToRemove)) {
        return res.status(400).json({ error: 'package_id and local sticker ID arrays are required' });
      }

      const link = await container.repositories.telegramPackLink.findByUserIdAndPackageId(userId, packageId);
      if (!link) {
        return res.status(404).json({ error: 'Telegram pack link not found' });
      }
      if (stickerIdsToAdd.length === 0 && stickerIdsToRemove.length === 0) {
        const status = await TelegramService.getPackStatus({ setName: link.setName });
        return res.status(200).json({
          set_name: link.setName,
          added: 0,
          removed: 0,
          add_sticker_url: status.addStickerUrl
        });
      }
      const packageResult = await resolvePackageAndStickers({
        userId,
        packageId,
        stickerIds: [...stickerIdsToAdd, ...stickerIdsToRemove]
      });
      const addIds = new Set(stickerIdsToAdd);
      const removeIds = new Set(stickerIdsToRemove);
      const addStickers = packageResult.stickers.filter(sticker => addIds.has(sticker.id));
      const addReferences = await Promise.all(addStickers.map(sticker =>
        container.services.asset.getSignedUrl(sticker.objectKey, userId)
      ));
      const removeFileIds = [...removeIds].map(stickerId => link.stickerFileIds[stickerId]);
      if (removeFileIds.some(fileId => !fileId)) {
        return res.status(404).json({ error: 'Telegram sticker link not found for removal' });
      }

      const result = await TelegramService.reconcilePack({
        telegramUserId: link.telegramUserId,
        setName: link.setName,
        stickerReferencesToAdd: addReferences,
        stickerFileIdsToRemove: removeFileIds
      });
      const stickerFileIds = { ...link.stickerFileIds };
      addStickers.forEach((sticker, index) => {
        if (result.addedFileIds[index]) stickerFileIds[sticker.id] = result.addedFileIds[index];
      });
      for (const stickerId of removeIds) delete stickerFileIds[stickerId];
      link.setStickerFileIds(stickerFileIds);
      await container.repositories.telegramPackLink.update(link, userId);

      return res.status(200).json({
        set_name: result.setName,
        added: result.added,
        removed: result.removed,
        add_sticker_url: result.addStickerUrl
      });
    } catch (error) {
      console.error('[TelegramController] reconcilePack error:', error.message);
      return sendError(res, error, 'Failed to reconcile Telegram sticker pack');
    }
  },

  /** GET /api/v1/telegram/pack-status/:setName */
  async getPackStatus(req, res) {
    try {
      const userId = requireUser(req, res);
      if (!userId) return;
      const { setName } = req.params;
      if (!setName) return res.status(400).json({ error: 'setName is required' });
      const link = await container.repositories.telegramPackLink.findBySetName(setName, userId);
      if (!link) return res.status(404).json({ error: 'Telegram pack not found' });

      const result = await TelegramService.getPackStatus({ setName: link.setName });
      return res.status(200).json({
        set_name: result.setName,
        title: result.title,
        sticker_count: result.stickerCount,
        sticker_ids: result.stickerIds,
        add_sticker_url: result.addStickerUrl
      });
    } catch (error) {
      console.error('[TelegramController] getPackStatus error:', error.message);
      return sendError(res, error, 'Failed to get Telegram pack status');
    }
  }
};

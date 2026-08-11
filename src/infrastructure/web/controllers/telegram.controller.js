import { container } from '../../../config/container.js';
import { TelegramPackLink } from '../../../domain/entities/telegram-pack-link.entity.js';
import { getLogger } from '../../observability/logger.js';
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

/**
 * Rebuild stickerFileIds from the persisted local order and the remote
 * sticker list, then mark the link ACTIVE. A retry must never leave a link
 * ACTIVE with an empty stickerFileIds map, so this refuses to activate if
 * the rebuilt map is empty.
 */
function activateLinkFromRemoteSet(link, remoteSet) {
  const stickerFileIds = TelegramService.buildStickerFileIdsFromOrder(
    link.stickerIdOrder,
    remoteSet?.stickers || []
  );
  if (Object.keys(stickerFileIds).length === 0) {
    throw new Error('Telegram sticker set has no matching stickers to link; refusing to activate');
  }
  link.setStickerFileIds(stickerFileIds);
  link.markActive();
  return stickerFileIds;
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
      const stickerIdOrder = stickers.map(sticker => sticker.id);

      let link = await container.repositories.telegramPackLink.findByUserIdAndPackageId(userId, packageId);
      if (link && link.telegramUserId !== telegramIdentity.telegramUserId) {
        return res.status(403).json({ error: 'Telegram link belongs to another Telegram account' });
      }

      if (link && link.status === 'active') {
        const status = await TelegramService.getPackStatus({ setName: link.setName });
        return res.status(200).json({
          set_name: link.setName,
          add_sticker_url: status.addStickerUrl,
          sticker_count: status.stickerCount
        });
      }

      if (link && (link.status === 'pending' || link.status === 'failed')) {
        // Recover a prior attempt: the remote set may already exist even
        // though our local record never reached ACTIVE. Ambiguous results
        // (timeouts, 429s, 5xxs) must never be read as "does not exist".
        let remote;
        try {
          remote = await TelegramService.getRemoteSet({ setName: link.setName });
        } catch (error) {
          return sendError(res, error, 'Could not verify Telegram sticker set status; retry later');
        }
        if (remote.exists) {
          activateLinkFromRemoteSet(link, remote.set);
          await container.repositories.telegramPackLink.update(link, userId);
          return res.status(200).json({
            set_name: link.setName,
            add_sticker_url: `https://t.me/addstickers/${link.setName}`,
            sticker_count: remote.set?.stickers?.length || 0
          });
        }
        // Telegram explicitly confirmed the set does not exist; fall through
        // to (re)create it below.
      }

      const isNewLink = !link;
      if (isNewLink) {
        link = TelegramPackLink.create({
          userId,
          telegramUserId: telegramIdentity.telegramUserId,
          packageId,
          setName,
          stickerFileIds: {}
        });
      }
      // Persist the local sticker order and reset the link to PENDING right
      // before mutating the remote set — including when it was previously
      // FAILED and Telegram just confirmed the set does not exist — so a
      // later recovery can deterministically rebuild the file ID map and no
      // link is ever left FAILED while a create attempt might still be
      // in flight or ambiguous.
      link.setStickerIdOrder(stickerIdOrder);
      link.markPending();
      await (isNewLink
        ? container.repositories.telegramPackLink.save(link)
        : container.repositories.telegramPackLink.update(link, userId));

      try {
        await TelegramService.createRemoteSet({
          telegramUserId: telegramIdentity.telegramUserId,
          setName,
          packTitle: pkg.name,
          stickerReferences: references
        });
      } catch (error) {
        const classification = TelegramService.classifyCreateSetError(error);
        if (classification === 'name_occupied') {
          // The set already exists remotely (race, or a previous attempt
          // whose creation succeeded but whose confirmation did not).
          let remote;
          try {
            remote = await TelegramService.getRemoteSet({ setName: link.setName });
          } catch (lookupError) {
            return sendError(res, lookupError, 'Failed to export sticker pack to Telegram');
          }
          if (remote.exists) {
            activateLinkFromRemoteSet(link, remote.set);
            await container.repositories.telegramPackLink.update(link, userId);
            return res.status(200).json({
              set_name: link.setName,
              add_sticker_url: `https://t.me/addstickers/${link.setName}`,
              sticker_count: remote.set?.stickers?.length || 0
            });
          }
          return sendError(res, error, 'Failed to export sticker pack to Telegram');
        }
        if (classification === 'ambiguous') {
          // Transport failure/timeout, 429, or 5xx: we never learned whether
          // Telegram actually created the set, so the link must stay
          // PENDING. The next attempt will consult getRemoteSet before
          // trying createNewStickerSet again.
          return sendError(res, error, 'Failed to export sticker pack to Telegram; retry later');
        }
        // Telegram confirmed a definitive request error: no set was created.
        link.markFailed();
        await container.repositories.telegramPackLink.update(link, userId);
        throw error;
      }

      // Creation succeeded remotely; confirm it and rebuild the file ID map
      // before ever marking the link ACTIVE.
      let remoteAfterCreate;
      try {
        remoteAfterCreate = await TelegramService.getRemoteSet({ setName: link.setName });
      } catch (error) {
        // The set was created but we could not confirm its stickers yet.
        // Keep the link as-is (PENDING/FAILED) so the next attempt recovers
        // it above instead of re-running createNewStickerSet.
        return sendError(res, error, 'Sticker pack created but status could not be confirmed; retry to finish linking');
      }
      if (!remoteAfterCreate.exists) {
        return sendError(
          res,
          new Error('Telegram did not confirm the sticker set after creation'),
          'Failed to export sticker pack to Telegram'
        );
      }

      activateLinkFromRemoteSet(link, remoteAfterCreate.set);
      await container.repositories.telegramPackLink.update(link, userId);

      return res.status(201).json({
        set_name: link.setName,
        add_sticker_url: `https://t.me/addstickers/${link.setName}`,
        sticker_count: remoteAfterCreate.set?.stickers?.length || 0
      });
    } catch (error) {
      getLogger().error({ err: error }, '[TelegramController] exportPack error:');
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
      getLogger().error({ err: error }, '[TelegramController] reconcilePack error:');
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
      getLogger().error({ err: error }, '[TelegramController] getPackStatus error:');
      return sendError(res, error, 'Failed to get Telegram pack status');
    }
  }
};

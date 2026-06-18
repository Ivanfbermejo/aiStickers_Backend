/**
 * TelegramController
 *
 * Handles HTTP routes for Telegram sticker pack operations.
 * All endpoints require HMAC + User JWT.
 *
 * Routes (registered in index.js):
 *   POST /api/v1/telegram/export-pack
 *   POST /api/v1/telegram/reconcile-pack
 *   GET  /api/v1/telegram/pack-status/:setName
 */

import * as TelegramService from '../../../application/services/telegram.service.js';

const SENTINEL_USER_ID = 1;

export const TelegramController = {

    /**
     * POST /api/v1/telegram/export-pack
     * Body: { package_id, pack_name, sticker_urls: string[] }
     */
    async exportPack(req, res) {
        try {
            const { package_id, pack_name, sticker_urls } = req.body;

            if (!package_id || !pack_name || !Array.isArray(sticker_urls) || sticker_urls.length === 0) {
                return res.status(400).json({ error: 'package_id, pack_name, and sticker_urls are required' });
            }

            const userId = req.user?.telegramUserId ?? SENTINEL_USER_ID;

            const result = await TelegramService.exportPack({
                userId,
                packageId: package_id,
                packTitle: pack_name,
                stickerUrls: sticker_urls
            });

            return res.status(201).json({
                set_name: result.setName,
                add_sticker_url: result.addStickerUrl,
                sticker_count: result.stickerCount
            });
        } catch (err) {
            console.error('[TelegramController] exportPack error:', err.message);
            return res.status(500).json({ error: 'Failed to export sticker pack to Telegram', message: err.message });
        }
    },

    /**
     * POST /api/v1/telegram/reconcile-pack
     * Body: { package_id, set_name, sticker_urls_to_add: string[], sticker_ids_to_remove: string[] }
     */
    async reconcilePack(req, res) {
        try {
            const { package_id, set_name, sticker_urls_to_add, sticker_ids_to_remove } = req.body;

            if (!set_name) {
                return res.status(400).json({ error: 'set_name is required' });
            }

            const userId = req.user?.telegramUserId ?? SENTINEL_USER_ID;

            const result = await TelegramService.reconcilePack({
                userId,
                packageId: package_id ?? '',
                setName: set_name,
                stickerUrlsToAdd: sticker_urls_to_add ?? [],
                stickerIdsToRemove: sticker_ids_to_remove ?? []
            });

            return res.status(200).json({
                set_name: result.setName,
                added: result.added,
                removed: result.removed,
                add_sticker_url: result.addStickerUrl
            });
        } catch (err) {
            console.error('[TelegramController] reconcilePack error:', err.message);
            return res.status(500).json({ error: 'Failed to reconcile Telegram sticker pack', message: err.message });
        }
    },

    /**
     * GET /api/v1/telegram/pack-status/:setName
     */
    async getPackStatus(req, res) {
        try {
            const { setName } = req.params;
            if (!setName) {
                return res.status(400).json({ error: 'setName is required' });
            }

            const result = await TelegramService.getPackStatus({ setName });

            return res.status(200).json({
                set_name: result.setName,
                title: result.title,
                sticker_count: result.stickerCount,
                sticker_ids: result.stickerIds,
                add_sticker_url: result.addStickerUrl
            });
        } catch (err) {
            console.error('[TelegramController] getPackStatus error:', err.message);
            return res.status(500).json({ error: 'Failed to get Telegram pack status', message: err.message });
        }
    }
};

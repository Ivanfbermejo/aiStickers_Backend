import { container } from '../../../config/container.js';
import { Sticker } from '../../../domain/entities/sticker.entity.js';
import { env } from '../../../config/env.js';
import {
  isInternalUrl,
  validateClientImageReference
} from '../../../application/services/secure-asset.service.js';

function isAllowedExternalImageUrl(urlString) {
  if (isInternalUrl(urlString)) return true;
  return env.ENABLE_EXTERNAL_IMAGE_URLS;
}

async function privateUrl(objectKey, legacyUrl, ownerId) {
  if (objectKey) return container.services.asset.getSignedUrl(objectKey, ownerId);
  return env.NODE_ENV === 'production' ? null : (legacyUrl || null);
}

async function serializeSticker(sticker, ownerId) {
  return {
    id: sticker.id,
    packageId: sticker.packageId,
    name: sticker.name,
    imageUrl: await privateUrl(sticker.objectKey, sticker.imageUrl, ownerId),
    thumbnailUrl: await privateUrl(sticker.objectKey, sticker.thumbnailUrl, ownerId),
    whatsappWebpUrl: await privateUrl(sticker.whatsappObjectKey, sticker.whatsappWebpUrl, ownerId),
    width: sticker.width,
    height: sticker.height,
    durationMs: sticker.durationMs,
    sizeBytes: sticker.sizeBytes,
    mimeType: sticker.mimeType,
    exportStatus: sticker.exportStatus,
    exportError: sticker.exportError,
    status: sticker.status,
    prompt: sticker.prompt,
    cost: sticker.cost,
    createdAt: sticker.createdAt,
    updatedAt: sticker.updatedAt
  };
}

/**
 * Sticker Controller
 * Handles CRUD operations for stickers
 */
export class StickerController {
  
  /**
   * Get all stickers for current user
   * GET /api/v1/stickers
   */
  static async getUserStickers(req, res) {
    try {
      const userId = req.user?.sub;
      if (!userId) {
        return res.status(401).json({
          error: 'Unauthorized',
          message: 'User ID not found in token'
        });
      }

      const stickers = await container.repositories.sticker.findByUserId(userId);
      
      return res.json({
        success: true,
        count: stickers.length,
        stickers: await Promise.all(stickers.map(s => serializeSticker(s, userId)))
      });

    } catch (error) {
      console.error('Get user stickers error:', error);
      return res.status(500).json({
        error: 'Failed to get stickers',
        message: error.message
      });
    }
  }

  /**
   * Get stickers by package ID
   * GET /api/v1/stickers/package/:packageId
   */
  static async getStickersByPackage(req, res) {
    try {
      const userId = req.user?.sub;
      const { packageId } = req.params;
      
      if (!userId) {
        return res.status(401).json({
          error: 'Unauthorized',
          message: 'User ID not found in token'
        });
      }

      // Verify package belongs to user
      const pkg = await container.repositories.package.findById(packageId);
      if (!pkg || pkg.userId !== userId) {
        return res.status(404).json({
          error: 'Package not found',
          message: 'Package does not exist or does not belong to user'
        });
      }

      const stickers = await container.repositories.sticker.findByPackageId(packageId);
      
      return res.json({
        success: true,
        count: stickers.length,
        package: {
          id: pkg.id,
          name: pkg.name,
          author: pkg.author,
          icon: pkg.icon
        },
        stickers: await Promise.all(stickers.map(s => serializeSticker(s, userId)))
      });

    } catch (error) {
      console.error('Get stickers by package error:', error);
      return res.status(500).json({
        error: 'Failed to get stickers',
        message: error.message
      });
    }
  }

  /**
   * Get single sticker by ID
   * GET /api/v1/stickers/:id
   */
  static async getStickerById(req, res) {
    try {
      const userId = req.user?.sub;
      const { id } = req.params;
      
      if (!userId) {
        return res.status(401).json({
          error: 'Unauthorized',
          message: 'User ID not found in token'
        });
      }

      const sticker = await container.repositories.sticker.findById(id);
      
      if (!sticker || sticker.userId !== userId) {
        return res.status(404).json({
          error: 'Sticker not found',
          message: 'Sticker does not exist or does not belong to user'
        });
      }

      return res.json({
        success: true,
        sticker: { ...(await serializeSticker(sticker, userId)), replicateId: sticker.replicateId }
      });

    } catch (error) {
      console.error('Get sticker by id error:', error);
      return res.status(500).json({
        error: 'Failed to get sticker',
        message: error.message
      });
    }
  }

  /**
   * Create a new sticker manually
   * POST /api/v1/stickers
   */
  static async createSticker(req, res) {
    try {
      const userId = req.user?.sub;
      const { name, packageId, imageUrl, thumbnailUrl, prompt } = req.body || {};
      
      if (!userId) {
        return res.status(401).json({
          error: 'Unauthorized',
          message: 'User ID not found in token'
        });
      }

      if (!imageUrl) {
        return res.status(400).json({
          error: 'Bad request',
          message: 'imageUrl is required'
        });
      }

      if (!isAllowedExternalImageUrl(imageUrl)) {
        return res.status(400).json({
          error: 'External image URLs disabled',
          message: 'External image URLs are not enabled'
        });
      }

      try {
        await validateClientImageReference(imageUrl, { allowlist: env.EXTERNAL_IMAGE_URL_ALLOWLIST });
      } catch (err) {
        return res.status(400).json({
          error: 'Invalid image URL',
          message: err.message
        });
      }

      let asset;
      try {
        asset = await container.services.asset.ingestClientAsset({
          reference: imageUrl,
          ownerId: userId,
          allowlist: env.EXTERNAL_IMAGE_URL_ALLOWLIST
        });
      } catch (err) {
        return res.status(400).json({ error: 'Invalid image asset', message: err.message });
      }

      // If packageId provided, verify it belongs to user
      if (packageId) {
        const pkg = await container.repositories.package.findById(packageId);
        if (!pkg || pkg.userId !== userId) {
          return res.status(404).json({
            error: 'Package not found',
            message: 'Package does not exist or does not belong to user'
          });
        }
      }

      const sticker = new Sticker({
        id: `sticker_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        userId,
        packageId: packageId || null,
        name: name || 'New Sticker',
        imageUrl: null,
        thumbnailUrl: null,
        objectKey: asset.key,
        objectHash: asset.hash,
        objectSize: asset.sizeBytes,
        objectMime: asset.mimeType,
        objectWidth: asset.width,
        objectHeight: asset.height,
        width: asset.width,
        height: asset.height,
        sizeBytes: asset.sizeBytes,
        mimeType: asset.mimeType,
        status: 'done',
        prompt: prompt || '',
        cost: 0 // Manual creation doesn't cost
      });

      await container.repositories.sticker.save(sticker);

      // Update package sticker count if packageId provided
      if (packageId) {
        const pkg = await container.repositories.package.findById(packageId);
        if (pkg) {
          pkg.incrementStickerCount();
          await container.repositories.package.update(pkg);
        }
      }

      return res.status(201).json({
        success: true,
        message: 'Sticker created successfully',
        sticker: await serializeSticker(sticker, userId)
      });

    } catch (error) {
      console.error('Create sticker error:', error);
      return res.status(500).json({
        error: 'Failed to create sticker',
        message: error.message
      });
    }
  }

  /**
   * Update sticker (name, package)
   * PUT /api/v1/stickers/:id
   */
  static async updateSticker(req, res) {
    try {
      const userId = req.user?.sub;
      const { id } = req.params;
      const { name, packageId } = req.body || {};
      
      if (!userId) {
        return res.status(401).json({
          error: 'Unauthorized',
          message: 'User ID not found in token'
        });
      }

      const sticker = await container.repositories.sticker.findById(id);
      
      if (!sticker || sticker.userId !== userId) {
        return res.status(404).json({
          error: 'Sticker not found',
          message: 'Sticker does not exist or does not belong to user'
        });
      }

      // Track if package changed
      const oldPackageId = sticker.packageId;

      // If moving to new package, verify it belongs to user
      if (packageId && packageId !== oldPackageId) {
        const pkg = await container.repositories.package.findById(packageId);
        if (!pkg || pkg.userId !== userId) {
          return res.status(404).json({
            error: 'Package not found',
            message: 'Package does not exist or does not belong to user'
          });
        }
        
        sticker.moveToPackage(packageId);
        
        // Update package counts
        if (oldPackageId) {
          const oldPkg = await container.repositories.package.findById(oldPackageId);
          if (oldPkg) {
            oldPkg.decrementStickerCount();
            await container.repositories.package.update(oldPkg);
          }
        }
        
        const newPkg = await container.repositories.package.findById(packageId);
        if (newPkg) {
          newPkg.incrementStickerCount();
          await container.repositories.package.update(newPkg);
        }
      }

      if (name) {
        sticker.updateName(name);
      }

      await container.repositories.sticker.update(sticker);

      return res.json({
        success: true,
        message: 'Sticker updated successfully',
        sticker: await serializeSticker(sticker, userId)
      });

    } catch (error) {
      console.error('Update sticker error:', error);
      return res.status(500).json({
        error: 'Failed to update sticker',
        message: error.message
      });
    }
  }

  /**
   * Delete a sticker
   * DELETE /api/v1/stickers/:id
   */
  static async deleteSticker(req, res) {
    try {
      const userId = req.user?.sub;
      const { id } = req.params;
      
      if (!userId) {
        return res.status(401).json({
          error: 'Unauthorized',
          message: 'User ID not found in token'
        });
      }

      const sticker = await container.repositories.sticker.findById(id);
      
      if (!sticker || sticker.userId !== userId) {
        return res.status(404).json({
          error: 'Sticker not found',
          message: 'Sticker does not exist or does not belong to user'
        });
      }

      // Update package sticker count if sticker was in a package
      if (sticker.packageId) {
        const pkg = await container.repositories.package.findById(sticker.packageId);
        if (pkg) {
          pkg.decrementStickerCount();
          await container.repositories.package.update(pkg);
        }
      }

      const cleanupTasks = await Promise.all([sticker.objectKey, sticker.whatsappObjectKey]
        .filter(Boolean).map(key => container.services.assetCleanup.schedule({ key, ownerId: userId, entity: `sticker:${id}` })));
      try {
        await container.repositories.sticker.delete(id);
      } catch (error) {
        await Promise.all(cleanupTasks.map(task => container.services.assetCleanup.cancel(task)));
        throw error;
      }
      await Promise.all(cleanupTasks.map(async task => {
        await container.services.assetCleanup.confirm(task);
        return container.services.assetCleanup.run(task).catch(error => console.error(`[AssetCleanup] deferred cleanup for ${task.key}:`, error.message));
      }));

      return res.json({
        success: true,
        message: 'Sticker deleted successfully'
      });

    } catch (error) {
      console.error('Delete sticker error:', error);
      return res.status(500).json({
        error: 'Failed to delete sticker',
        message: error.message
      });
    }
  }
}

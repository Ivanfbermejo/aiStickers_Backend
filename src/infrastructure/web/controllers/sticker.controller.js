import { container } from '../../../config/container.js';
import { Sticker } from '../../../domain/entities/sticker.entity.js';

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
        stickers: stickers.map(s => ({
          id: s.id,
          packageId: s.packageId,
          name: s.name,
          imageUrl: s.imageUrl,
          thumbnailUrl: s.thumbnailUrl,
          whatsappWebpUrl: s.whatsappWebpUrl,
          width: s.width,
          height: s.height,
          durationMs: s.durationMs,
          sizeBytes: s.sizeBytes,
          mimeType: s.mimeType,
          exportStatus: s.exportStatus,
          exportError: s.exportError,
          status: s.status,
          prompt: s.prompt,
          cost: s.cost,
          createdAt: s.createdAt,
          updatedAt: s.updatedAt
        }))
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
        stickers: stickers.map(s => ({
          id: s.id,
          name: s.name,
          imageUrl: s.imageUrl,
          thumbnailUrl: s.thumbnailUrl,
          whatsappWebpUrl: s.whatsappWebpUrl,
          width: s.width,
          height: s.height,
          durationMs: s.durationMs,
          sizeBytes: s.sizeBytes,
          mimeType: s.mimeType,
          exportStatus: s.exportStatus,
          exportError: s.exportError,
          status: s.status,
          createdAt: s.createdAt
        }))
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
        sticker: {
          id: sticker.id,
          packageId: sticker.packageId,
          name: sticker.name,
          imageUrl: sticker.imageUrl,
          thumbnailUrl: sticker.thumbnailUrl,
          whatsappWebpUrl: sticker.whatsappWebpUrl,
          width: sticker.width,
          height: sticker.height,
          durationMs: sticker.durationMs,
          sizeBytes: sticker.sizeBytes,
          mimeType: sticker.mimeType,
          exportStatus: sticker.exportStatus,
          exportError: sticker.exportError,
          replicateId: sticker.replicateId,
          status: sticker.status,
          prompt: sticker.prompt,
          cost: sticker.cost,
          createdAt: sticker.createdAt,
          updatedAt: sticker.updatedAt
        }
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
        imageUrl,
        thumbnailUrl: thumbnailUrl || imageUrl,
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
        sticker: {
          id: sticker.id,
          packageId: sticker.packageId,
          name: sticker.name,
          imageUrl: sticker.imageUrl,
          thumbnailUrl: sticker.thumbnailUrl,
          whatsappWebpUrl: sticker.whatsappWebpUrl,
          exportStatus: sticker.exportStatus,
          status: sticker.status,
          createdAt: sticker.createdAt
        }
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
        sticker: {
          id: sticker.id,
          packageId: sticker.packageId,
          name: sticker.name,
          imageUrl: sticker.imageUrl,
          thumbnailUrl: sticker.thumbnailUrl,
          whatsappWebpUrl: sticker.whatsappWebpUrl,
          exportStatus: sticker.exportStatus,
          exportError: sticker.exportError,
          updatedAt: sticker.updatedAt
        }
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

      await container.repositories.sticker.delete(id);

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

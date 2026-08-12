import { container } from '../../../config/container.js';
import { Package } from '../../../domain/entities/package.entity.js';
import { env } from '../../../config/env.js';
import { getLogger } from '../../observability/logger.js';

async function trayIconUrl(pkg, requesterId) {
  if (pkg.trayIconObjectKey && pkg.userId === requesterId) {
    return container.services.asset.getSignedUrl(pkg.trayIconObjectKey, requesterId);
  }
  return env.NODE_ENV === 'production' ? null : (pkg.trayIconUrl || null);
}

async function stickerUrls(sticker, requesterId, ownerId) {
  const canRead = requesterId === ownerId;
  const result = {
    id: sticker.id,
    name: sticker.name,
    imageUrl: canRead && sticker.objectKey
      ? await container.services.asset.getSignedUrl(sticker.objectKey, requesterId)
      : (env.NODE_ENV === 'production' ? null : sticker.imageUrl),
    thumbnailUrl: canRead && sticker.objectKey
      ? await container.services.asset.getSignedUrl(sticker.objectKey, requesterId)
      : (env.NODE_ENV === 'production' ? null : sticker.thumbnailUrl)
  };
  if (canRead) {
    result.whatsappWebpUrl = sticker.whatsappObjectKey
      ? await container.services.asset.getSignedUrl(sticker.whatsappObjectKey, requesterId)
      : (env.NODE_ENV === 'production' ? null : sticker.whatsappWebpUrl);
    result.exportStatus = sticker.exportStatus;
    result.exportError = sticker.exportError;
    result.status = sticker.status;
  }
  return result;
}

/**
 * Package Controller
 * Handles CRUD operations for packages
 */
export class PackageController {
  
  /**
   * Get all packages for current user
   * GET /api/v1/packages
   */
  static async getUserPackages(req, res) {
    try {
      const userId = req.user?.sub;
      if (!userId) {
        return res.status(401).json({
          error: 'Unauthorized',
          message: 'User ID not found in token'
        });
      }

      const packages = await container.repositories.package.findByUserId(userId);
      
      return res.json({
        success: true,
        count: packages.length,
        packages: await Promise.all(packages.map(async p => ({
          id: p.id,
          name: p.name,
          author: p.author,
          icon: p.icon,
          description: p.description,
          stickerCount: p.stickerCount,
          category: p.category,
          tags: p.tags,
          isPublic: p.isPublic,
          packType: p.packType,
          trayIconUrl: await trayIconUrl(p, userId),
          whatsappReady: p.whatsappReady,
          exportStatus: p.exportStatus,
          exportError: p.exportError,
          createdAt: p.createdAt,
          updatedAt: p.updatedAt
        })))
      });

    } catch (error) {
      getLogger().error({ err: error }, 'Get user packages error:');
      return res.status(500).json({
        error: 'Failed to get packages',
        message: error.message
      });
    }
  }

  /**
   * Get public packages (for gallery/discovery)
   * GET /api/v1/packages/public
   */
  static async getPublicPackages(req, res) {
    try {
      const { category, limit = 50 } = req.query || {};
      
      let packages;
      if (category) {
        packages = await container.repositories.package.findByCategory(category);
      } else {
        packages = await container.repositories.package.findPublic();
      }

      // Limit results
      packages = packages.slice(0, parseInt(limit));
      
      return res.json({
        success: true,
        count: packages.length,
        packages: packages.map(p => ({
          id: p.id,
          name: p.name,
          author: p.author,
          icon: p.icon,
          description: p.description,
          stickerCount: p.stickerCount,
          category: p.category,
          tags: p.tags,
          packType: p.packType,
          trayIconUrl: env.NODE_ENV === 'production' ? null : p.trayIconUrl,
          createdAt: p.createdAt
        }))
      });

    } catch (error) {
      getLogger().error({ err: error }, 'Get public packages error:');
      return res.status(500).json({
        error: 'Failed to get public packages',
        message: error.message
      });
    }
  }

  /**
   * Get single package by ID
   * GET /api/v1/packages/:id
   */
  static async getPackageById(req, res) {
    try {
      const userId = req.user?.sub;
      const { id } = req.params;
      
      if (!userId) {
        return res.status(401).json({
          error: 'Unauthorized',
          message: 'User ID not found in token'
        });
      }

      let pkg = await container.repositories.package.findById(id, userId);
      if (!pkg) {
        pkg = await container.repositories.package.findPublicById(id);
      }
      
      if (!pkg) {
        return res.status(404).json({
          error: 'Package not found',
          message: 'Package does not exist'
        });
      }

      // Get stickers in this package
      const stickers = await container.repositories.sticker.findByPackageId(id, pkg.userId);

      const isOwner = pkg.userId === userId;
      return res.json({
        success: true,
        package: {
          id: pkg.id,
          name: pkg.name,
          author: pkg.author,
          icon: pkg.icon,
          description: pkg.description,
          stickerCount: pkg.stickerCount,
          category: pkg.category,
          tags: pkg.tags,
          isPublic: pkg.isPublic,
          packType: pkg.packType,
          trayIconUrl: await trayIconUrl(pkg, userId),
          ...(isOwner ? {
            whatsappReady: pkg.whatsappReady,
            exportStatus: pkg.exportStatus,
            exportError: pkg.exportError
          } : {}),
          createdAt: pkg.createdAt,
          updatedAt: pkg.updatedAt,
          stickers: await Promise.all(stickers.map(s => stickerUrls(s, userId, pkg.userId)))
        }
      });

    } catch (error) {
      getLogger().error({ err: error }, 'Get package by id error:');
      return res.status(500).json({
        error: 'Failed to get package',
        message: error.message
      });
    }
  }

  /**
   * Create a new package
   * POST /api/v1/packages
   */
  static async createPackage(req, res) {
    try {
      const userId = req.user?.sub;
      const { name, author, icon, description, category, isPublic } = req.body || {};
      
      if (!userId) {
        return res.status(401).json({
          error: 'Unauthorized',
          message: 'User ID not found in token'
        });
      }

      if (!name || name.trim().length === 0) {
        return res.status(400).json({
          error: 'Bad request',
          message: 'Package name is required'
        });
      }

      const pkg = Package.create({
        userId,
        name: name.trim(),
        author: author || req.user?.name || 'Unknown',
        icon,
        description,
        category: category || 'general',
        isPublic: isPublic || false
      });

      await container.repositories.package.save(pkg);

      return res.status(201).json({
        success: true,
        message: 'Package created successfully',
        package: {
          id: pkg.id,
          name: pkg.name,
          author: pkg.author,
          icon: pkg.icon,
          description: pkg.description,
          stickerCount: pkg.stickerCount,
          category: pkg.category,
          isPublic: pkg.isPublic,
          packType: pkg.packType,
          whatsappReady: pkg.whatsappReady,
          exportStatus: pkg.exportStatus,
          createdAt: pkg.createdAt
        }
      });

    } catch (error) {
      getLogger().error({ err: error }, 'Create package error:');
      return res.status(500).json({
        error: 'Failed to create package',
        message: error.message
      });
    }
  }

  /**
   * Update a package
   * PUT /api/v1/packages/:id
   */
  static async updatePackage(req, res) {
    try {
      const userId = req.user?.sub;
      const { id } = req.params;
      const { name, author, icon, description, category, isPublic, tags, packType } = req.body || {};
      
      if (!userId) {
        return res.status(401).json({
          error: 'Unauthorized',
          message: 'User ID not found in token'
        });
      }

      const pkg = await container.repositories.package.findById(id, userId);
      
      if (!pkg) {
        return res.status(404).json({
          error: 'Package not found',
          message: 'Package does not exist or does not belong to user'
        });
      }

      // Update fields
      if (name !== undefined) {
        pkg.updateName(name);
      }
      if (author !== undefined) {
        pkg.setAuthor(author);
      }
      if (description !== undefined) {
        pkg.updateDescription(description);
      }
      if (icon !== undefined) {
        pkg.updateIcon(icon);
      }
      if (category !== undefined) {
        pkg.setCategory(category);
      }
      if (packType !== undefined) {
        pkg.setPackType(packType);
      }
      if (isPublic !== undefined) {
        if (isPublic) {
          pkg.isPublic = true;
        } else {
          pkg.isPublic = false;
        }
        pkg.updatedAt = new Date().toISOString();
      }

      await container.repositories.package.update(pkg, userId);

      return res.json({
        success: true,
        message: 'Package updated successfully',
        package: {
          id: pkg.id,
          name: pkg.name,
          author: pkg.author,
          icon: pkg.icon,
          description: pkg.description,
          stickerCount: pkg.stickerCount,
          category: pkg.category,
          isPublic: pkg.isPublic,
          packType: pkg.packType,
          trayIconUrl: await trayIconUrl(pkg, userId),
          whatsappReady: pkg.whatsappReady,
          exportStatus: pkg.exportStatus,
          exportError: pkg.exportError,
          updatedAt: pkg.updatedAt
        }
      });

    } catch (error) {
      getLogger().error({ err: error }, 'Update package error:');
      return res.status(500).json({
        error: 'Failed to update package',
        message: error.message
      });
    }
  }

  /**
   * Delete a package
   * DELETE /api/v1/packages/:id
   */
  static async deletePackage(req, res) {
    try {
      const userId = req.user?.sub;
      const { id } = req.params;
      
      if (!userId) {
        return res.status(401).json({
          error: 'Unauthorized',
          message: 'User ID not found in token'
        });
      }

      const pkg = await container.repositories.package.findById(id, userId);
      
      if (!pkg) {
        return res.status(404).json({
          error: 'Package not found',
          message: 'Package does not exist or does not belong to user'
        });
      }

      // Update stickers to remove package reference
      const stickers = await container.repositories.sticker.findByPackageId(id, userId);
      for (const sticker of stickers) {
        sticker.packageId = null;
        await container.repositories.sticker.update(sticker, userId);
      }

      const cleanupTask = pkg.trayIconObjectKey
        ? await container.services.assetCleanup.schedule({ key: pkg.trayIconObjectKey, ownerId: userId, entity: `package:${id}` })
        : null;
      try {
        await container.repositories.package.delete(id, userId);
      } catch (error) {
        if (cleanupTask) await container.services.assetCleanup.cancel(cleanupTask);
        throw error;
      }
      if (cleanupTask) {
        await container.services.assetCleanup.confirm(cleanupTask);
        await container.services.assetCleanup.run(cleanupTask).catch(error => getLogger().error({ err: error }, `[AssetCleanup] deferred cleanup for ${cleanupTask.key}:`));
      }
      await container.repositories.telegramPackLink?.deleteByPackageId(id, userId);

      return res.json({
        success: true,
        message: 'Package deleted successfully',
        stickersMoved: stickers.length
      });

    } catch (error) {
      getLogger().error({ err: error }, 'Delete package error:');
      return res.status(500).json({
        error: 'Failed to delete package',
        message: error.message
      });
    }
  }
}

import { container } from '../../../config/container.js';
import { env } from '../../../config/env.js';
import {
  isInternalUrl,
  validateClientImageReference
} from '../../../application/services/secure-asset.service.js';
import { resolveClientAsset } from './client-asset.js';

function isAllowedExternalImageUrl(urlString) {
  if (isInternalUrl(urlString)) return true;
  return env.ENABLE_EXTERNAL_IMAGE_URLS;
}

async function presentPrivateResult(result, userId) {
  if (!result?.objectKey) return env.NODE_ENV === 'production' ? undefined : result;
  return {
    ...result,
    url: await container.services.asset.getSignedUrl(result.objectKey, userId)
  };
}

/**
 * Generation Controller
 * Handles async AI generation endpoints
 */
export class GenerationController {
  /**
   * Create a new generation job
   * POST /api/v1/generation
   */
  static async create(req, res) {
    try {
      const dependencies = req.app.locals.container || container;
      const userId = req.user?.sub;
      if (!userId) {
        return res.status(401).json({
          error: 'Unauthorized',
          message: 'User ID not found in token'
        });
      }

      const { type, imageUrl, objectKey, hash, prompt, styleId, emoji, packageId } = req.body || {};

      if (!type) {
        return res.status(400).json({
          error: 'Bad request',
          message: 'type is required'
        });
      }
      if (type === 'animated_sticker' || type === 'img2vid') {
        return res.status(503).json({ error: 'Video generation unavailable', message: 'Video generation is disabled until T12' });
      }

      if (imageUrl && !isAllowedExternalImageUrl(imageUrl)) {
        return res.status(400).json({
          error: 'External image URLs disabled',
          message: 'External image URLs are not enabled'
        });
      }

      if (objectKey && imageUrl) {
        return res.status(400).json({
          error: 'Multiple image references',
          message: 'Provide objectKey and hash or imageUrl, not both'
        });
      }

      let inputAsset;
      if (imageUrl || objectKey) {
        try {
          if (imageUrl) {
            await validateClientImageReference(imageUrl, { allowlist: env.EXTERNAL_IMAGE_URL_ALLOWLIST });
          }
          inputAsset = await resolveClientAsset({
            assetService: dependencies.services.asset,
            objectKey,
            hash,
            reference: imageUrl,
            ownerId: userId,
            allowlist: env.EXTERNAL_IMAGE_URL_ALLOWLIST
          });
        } catch (err) {
          return res.status(400).json({
            error: 'Invalid image asset',
            message: err.message
          });
        }
      }

      const result = await dependencies.useCases.createGenerationJob.execute({
        userId,
        type,
        asset: inputAsset,
        prompt,
        styleId,
        emoji,
        packageId
      });

      return res.status(201).json(result);
    } catch (error) {
      console.error('Generation create error:', error);

      if (error.message === 'Insufficient balance') {
        return res.status(400).json({
          error: 'Insufficient balance',
          message: 'Need 1 StickerDollar to generate'
        });
      }

      if (error.code === 'ACTIVE_GENERATION_LIMIT') {
        res.set('Retry-After', String(error.retryAfterSeconds));
        return res.status(429).json({
          error: 'Too many requests',
          message: 'Active generation limit exceeded'
        });
      }

      if (error.code === 'PACKAGE_NOT_FOUND') {
        return res.status(404).json({
          error: 'Package not found',
          message: error.message
        });
      }

      return res.status(500).json({
        error: 'Failed to create generation job',
        message: error.message
      });
    }
  }

  /**
   * Get generation job by ID
   * GET /api/v1/generation/:jobId
   */
  static async getById(req, res) {
    try {
      const userId = req.user?.sub;
      const { jobId } = req.params;

      if (!userId) {
        return res.status(401).json({
          error: 'Unauthorized',
          message: 'User ID not found in token'
        });
      }

      const { found, job, sticker } = await container.useCases.getGenerationJob.execute({
        userId,
        jobId
      });

      if (!found) {
        return res.status(404).json({
          error: 'Not found',
          message: 'Job does not exist or does not belong to user'
        });
      }

      const response = {
        success: true,
        job: {
          id: job.id,
          status: job.status,
          currentStep: job.currentStep,
          progress: job.progress,
          stickerId: job.stickerId,
          type: job.type,
          errorMessage: job.errorMessage,
          result: await presentPrivateResult(job.result, userId)
        }
      };

      if (sticker && job.status === 'completed') {
        response.sticker = {
          id: sticker.id,
          packageId: sticker.packageId,
          name: sticker.name,
          imageUrl: sticker.objectKey
            ? await container.services.asset.getSignedUrl(sticker.objectKey, userId)
            : (env.NODE_ENV === 'production' ? null : sticker.imageUrl),
          thumbnailUrl: sticker.objectKey
            ? await container.services.asset.getSignedUrl(sticker.objectKey, userId)
            : (env.NODE_ENV === 'production' ? null : sticker.thumbnailUrl),
          status: sticker.status
        };
      }

      return res.json(response);
    } catch (error) {
      console.error('Generation getById error:', error);
      return res.status(500).json({
        error: 'Failed to get generation job',
        message: error.message
      });
    }
  }

  /**
   * List all generation jobs for current user
   * GET /api/v1/generation
   */
  static async getUserJobs(req, res) {
    try {
      const userId = req.user?.sub;
      if (!userId) {
        return res.status(401).json({
          error: 'Unauthorized',
          message: 'User ID not found in token'
        });
      }

      const result = await container.useCases.getGenerationJobs.execute({ userId });

      return res.json({
        success: true,
        count: result.count,
        jobs: await Promise.all(result.jobs.map(async job => ({
          id: job.id,
          status: job.status,
          currentStep: job.currentStep,
          progress: job.progress,
          stickerId: job.stickerId,
          type: job.type,
          errorMessage: job.errorMessage,
          result: await presentPrivateResult(job.result, userId),
          createdAt: job.createdAt,
          updatedAt: job.updatedAt
        })))
      });
    } catch (error) {
      console.error('Generation getUserJobs error:', error);
      return res.status(500).json({
        error: 'Failed to list generation jobs',
        message: error.message
      });
    }
  }
}

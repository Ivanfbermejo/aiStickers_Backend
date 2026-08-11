import fetch from 'node-fetch';
import { env } from '../../../config/env.js';
import { container } from '../../../config/container.js';
import { getLogger } from '../../observability/logger.js';
import { isInternalUrl, validateClientImageReference } from '../../../application/services/secure-asset.service.js';
import { resolveClientAsset } from './client-asset.js';

function isAllowedExternalImageUrl(urlString) {
  if (isInternalUrl(urlString)) return true;
  return env.ENABLE_EXTERNAL_IMAGE_URLS;
}

/**
 * AI Controller
 * Legacy AI endpoints kept as thin wrappers over the async generation pipeline
 */
export class AiController {

  /**
   * Process image to generate sticker
   * POST /api/v1/ai/process-image
   * Expects multipart/form-data with 'image' field
   */
  static async processImage(req, res) {
    try {
      const dependencies = req.app.locals.container || container;
      const { prompt, packageId, objectKey, hash } = req.body || {};

      if (!req.file && !req.body?.imageUrl && !objectKey) {
        return res.status(400).json({
          error: 'No image provided',
          message: 'Upload an image file or provide imageUrl'
        });
      }

      const userId = req.user?.sub;
      if (!userId) {
        return res.status(401).json({
          error: 'Unauthorized',
          message: 'User ID not found in token'
        });
      }

      const imageUrl = req.body?.imageUrl;

      if (objectKey && imageUrl) {
        return res.status(400).json({
          error: 'Multiple image references',
          message: 'Provide objectKey and hash or imageUrl, not both'
        });
      }

      if (imageUrl && !isAllowedExternalImageUrl(imageUrl)) {
        return res.status(400).json({
          error: 'External image URLs disabled',
          message: 'External image URLs are not enabled'
        });
      }

      if (!req.file && !objectKey) {
        try {
          await validateClientImageReference(imageUrl, { allowlist: env.EXTERNAL_IMAGE_URL_ALLOWLIST });
        } catch (err) {
          return res.status(400).json({
            error: 'Invalid image URL',
            message: err.message
          });
        }
      }

      let inputAsset;
      try {
        inputAsset = await resolveClientAsset({
          assetService: dependencies.services.asset,
          objectKey,
          hash,
          reference: imageUrl,
          buffer: req.file?.buffer,
          declaredMimeType: req.file?.mimetype,
          ownerId: userId,
          allowlist: env.EXTERNAL_IMAGE_URL_ALLOWLIST
        });
      } catch (err) {
        return res.status(400).json({
          error: 'Invalid uploaded image',
          message: err.message
        });
      }

      const finalPrompt = (prompt?.trim()) || 'clean sticker with white border, high contrast, professional quality, preserving exact facial features, face shape, eye color, hair style and color, skin tone, and distinctive characteristics. Keep the face perfectly recognizable and faithful to the original person.';

      const result = await dependencies.useCases.createGenerationJob.execute({
        userId,
        type: 'image_sticker',
        asset: inputAsset,
        prompt: finalPrompt,
        packageId
      });

      return res.json(result);

    } catch (error) {
      getLogger().error({ err: error }, 'AI processImage error');

      if (error.message === 'Insufficient balance') {
        return res.status(400).json({
          error: 'Insufficient balance',
          message: 'Need 1 StickerDollar to generate a sticker'
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
        error: 'Sticker generation failed',
        message: error.message || 'Internal error'
      });
    }
  }

  /**
   * Image to video generation
   * POST /api/v1/ai/img2vid
   */
  static async img2vid(_req, res) {
    return res.status(503).json({
      error: 'Video generation unavailable',
      message: 'Video generation is disabled until T12'
    });
  }

  /**
   * Get generation status (for async polling)
   * GET /api/v1/ai/status/:predictionId
   */
  static async getStatus(req, res) {
    try {
      const { predictionId } = req.params;
      const userId = req.user?.sub;
      if (!userId) {
        return res.status(401).json({
          error: 'Unauthorized',
          message: 'User ID not found in token'
        });
      }

      const dependencies = req.app.locals.container || container;
      const job = await dependencies.repositories.generationJob.findByProviderPredictionId(predictionId, userId);
      if (!job) {
        return res.status(404).json({
          error: 'Prediction not found',
          message: 'Prediction does not exist or does not belong to user'
        });
      }
      const response = await fetch(`https://api.replicate.com/v1/predictions/${predictionId}`, {
        headers: { Authorization: `Token ${process.env.REPLICATE_API_TOKEN}` }
      });

      if (!response.ok) {
        throw new Error(`Replicate API returned ${response.status}`);
      }

      const prediction = await response.json();

      return res.json({
        success: true,
        status: prediction.status,
        error: prediction.error,
        message: prediction.status === 'succeeded'
          ? 'Result is being copied to private storage; poll the generation job endpoint.'
          : undefined
      });

    } catch (error) {
      getLogger().error({ err: error }, 'AI getStatus error');
      return res.status(500).json({
        error: 'Failed to get status',
        message: error.message
      });
    }
  }
}

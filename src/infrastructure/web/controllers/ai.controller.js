import fetch from 'node-fetch';
import { env } from '../../../config/env.js';
import { container } from '../../../config/container.js';
import { isInternalUrl, validateClientImageReference } from '../../../application/services/secure-asset.service.js';

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
      const { prompt, packageId } = req.body || {};

      if (!req.file && !req.body?.imageUrl) {
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

      if (imageUrl && !isAllowedExternalImageUrl(imageUrl)) {
        return res.status(400).json({
          error: 'External image URLs disabled',
          message: 'External image URLs are not enabled'
        });
      }

      if (!req.file) {
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
        inputAsset = await container.services.asset.ingestClientAsset({
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

      const result = await container.useCases.createGenerationJob.execute({
        userId,
        type: 'image_sticker',
        asset: inputAsset,
        prompt: finalPrompt,
        packageId
      });

      return res.json(result);

    } catch (error) {
      console.error('AI processImage error:', error);

      if (error.message === 'Insufficient balance') {
        return res.status(400).json({
          error: 'Insufficient balance',
          message: 'Need 1 StickerDollar to generate a sticker'
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
  static async img2vid(req, res) {
    try {
      const { imageUrl, prompt, duration, resolution, fps } = req.body || {};

      if (!imageUrl) {
        return res.status(400).json({
          error: 'imageUrl is required'
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

      const userId = req.user?.sub;
      if (!userId) {
        return res.status(401).json({
          error: 'Unauthorized',
          message: 'User ID not found in token'
        });
      }

      let inputAsset;
      try {
        inputAsset = await container.services.asset.ingestClientAsset({
          reference: imageUrl,
          ownerId: userId,
          allowlist: env.EXTERNAL_IMAGE_URL_ALLOWLIST
        });
      } catch (err) {
        return res.status(400).json({ error: 'Invalid image asset', message: err.message });
      }

      const result = await container.useCases.createGenerationJob.execute({
        userId,
        type: 'img2vid',
        asset: inputAsset,
        prompt,
        input: {
          duration,
          resolution,
          fps
        }
      });

      return res.json(result);

    } catch (error) {
      console.error('AI img2vid error:', error);

      if (error.message === 'Insufficient balance') {
        return res.status(400).json({
          error: 'Insufficient balance',
          message: 'Need 1 StickerDollar to generate a video'
        });
      }

      return res.status(500).json({
        error: 'Video generation failed',
        message: error.message || 'Internal error'
      });
    }
  }

  /**
   * Get generation status (for async polling)
   * GET /api/v1/ai/status/:predictionId
   */
  static async getStatus(req, res) {
    try {
      const { predictionId } = req.params;
      
      const response = await fetch(`https://api.replicate.com/v1/predictions/${predictionId}`, {
        headers: { Authorization: `Token ${process.env.REPLICATE_API_TOKEN}` }
      });
      
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
      console.error('AI getStatus error:', error);
      return res.status(500).json({
        error: 'Failed to get status',
        message: error.message
      });
    }
  }
}

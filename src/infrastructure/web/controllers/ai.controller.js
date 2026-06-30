import fetch from 'node-fetch';
import { container } from '../../../config/container.js';

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
      console.log('[AI Controller] processImage called (async wrapper)');
      console.log('[AI Controller] req.file:', req.file ? { name: req.file.originalname, size: req.file.size, mimetype: req.file.mimetype } : 'undefined');
      console.log('[AI Controller] req.body:', req.body);
      console.log('[AI Controller] Content-Type:', req.headers['content-type']);

      const { prompt, packageId } = req.body || {};

      if (!req.file && !req.body?.imageUrl) {
        console.log('[AI Controller] ❌ No file and no imageUrl');
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

      let imageUrl = req.body?.imageUrl;
      if (req.file) {
        const b64 = req.file.buffer.toString('base64');
        imageUrl = `data:${req.file.mimetype};base64,${b64}`;
        console.log('[AI Controller] 🖼️ Image converted to base64 data URI, size:', req.file.size);
      }

      const finalPrompt = (prompt?.trim()) || 'clean sticker with white border, high contrast, professional quality, preserving exact facial features, face shape, eye color, hair style and color, skin tone, and distinctive characteristics. Keep the face perfectly recognizable and faithful to the original person.';

      const result = await container.useCases.createGenerationJob.execute({
        userId,
        type: 'image_sticker',
        imageUrl,
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

      const userId = req.user?.sub;
      if (!userId) {
        return res.status(401).json({
          error: 'Unauthorized',
          message: 'User ID not found in token'
        });
      }

      const result = await container.useCases.createGenerationJob.execute({
        userId,
        type: 'img2vid',
        imageUrl,
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
        output: prediction.output,
        error: prediction.error,
        urls: prediction.urls
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

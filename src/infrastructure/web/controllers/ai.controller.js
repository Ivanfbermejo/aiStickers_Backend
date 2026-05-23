import { container } from '../../../config/container.js';
import { runStickerModel, runImageToVideo } from '../../../application/services/replicate.service.js';
import { Sticker } from '../../../domain/entities/sticker.entity.js';

/**
 * AI Controller
 * Handles AI-powered sticker generation endpoints
 */
export class AiController {
  
  /**
   * Process image to generate sticker
   * POST /api/v1/ai/process-image
   * Expects multipart/form-data with 'image' field
   */
  static async processImage(req, res) {
    try {
      console.log('[AI Controller] processImage called');
      console.log('[AI Controller] req.file:', req.file ? { name: req.file.originalname, size: req.file.size, mimetype: req.file.mimetype } : 'undefined');
      console.log('[AI Controller] req.body:', req.body);
      console.log('[AI Controller] Content-Type:', req.headers['content-type']);
      
      const { prompt } = req.body || {};
      
      if (!req.file && !req.body?.imageUrl) {
        console.log('[AI Controller] ❌ No file and no imageUrl');
        return res.status(400).json({ 
          error: 'No image provided',
          message: 'Upload an image file or provide imageUrl'
        });
      }

      // Get user ID from JWT
      const userId = req.user?.sub;
      if (!userId) {
        return res.status(401).json({
          error: 'Unauthorized',
          message: 'User ID not found in token'
        });
      }

      // Check user has sufficient balance
      const balance = await container.useCases.getBalance.execute({ userId });
      const stickerCost = 1; // 1 StickerDollar per sticker
      
      if (balance.stickerDollars < stickerCost) {
        return res.status(400).json({
          error: 'Insufficient balance',
          message: `Need ${stickerCost} StickerDollar(s) to generate a sticker`,
          currentBalance: balance.stickerDollars,
          required: stickerCost
        });
      }

      // Spend balance before processing
      await container.useCases.spendBalance.execute({
        userId,
        amount: stickerCost,
        productId: 'sticker_generation'
      });

      // Get image URL (from file upload or provided URL)
      let imageUrl = req.body?.imageUrl;
      if (req.file) {
        // For now, we need a way to serve the uploaded file publicly
        // This is a placeholder - in production, upload to S3/Cloudinary
        imageUrl = `${req.protocol}://${req.get('host')}/uploads/${req.file.filename}`;
      }

      // Default prompt for stickers
      const finalPrompt = (prompt?.trim()) || "clean sticker with white border, high contrast, professional quality";
      
      // Create sticker entity before processing
      const sticker = Sticker.createFromGeneration({
        userId,
        packageId: req.body?.packageId || null,
        name: req.file?.originalname?.split('.')[0] || 'Generated Sticker',
        prompt: finalPrompt,
        cost: stickerCost
      });
      
      // Save initial sticker (processing state)
      await container.repositories.sticker.save(sticker);
      
      // Call Replicate API
      const { url: generatedUrl, id, web } = await runStickerModel(imageUrl, finalPrompt);
      
      // Update sticker with result
      sticker.markAsDone(generatedUrl, web);
      sticker.replicateId = id;
      await container.repositories.sticker.update(sticker);

      // Return success response
      return res.json({
        success: true,
        stickerId: sticker.id,
        imageUrl: generatedUrl,
        thumbnailUrl: web,
        replicateId: id,
        cost: stickerCost,
        remainingBalance: balance.stickerDollars - stickerCost
      });

    } catch (error) {
      console.error('AI processImage error:', error);
      
      // If error occurred after spending balance, we should refund
      // TODO: Implement refund mechanism for failed generations
      
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

      const result = await runImageToVideo({
        imageUrl,
        prompt,
        duration,
        resolution,
        fps
      });

      return res.json({
        success: true,
        videoUrl: result.url,
        replicateId: result.id,
        web: result.web
      });

    } catch (error) {
      console.error('AI img2vid error:', error);
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

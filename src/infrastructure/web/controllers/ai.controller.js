import { container } from '../../../config/container.js';
import { runStickerModel, runImageToVideo } from '../../../application/services/replicate.service.js';

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
      const { prompt } = req.body || {};
      
      if (!req.file && !req.body?.imageUrl) {
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
      
      // Call Replicate API
      const { url: generatedUrl, id, web } = await runStickerModel(imageUrl, finalPrompt);

      // Return success response
      return res.json({
        success: true,
        imageUrl: generatedUrl,
        replicateId: id,
        web,
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

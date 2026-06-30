import { container } from '../../../config/container.js';

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
      const userId = req.user?.sub;
      if (!userId) {
        return res.status(401).json({
          error: 'Unauthorized',
          message: 'User ID not found in token'
        });
      }

      const { type, imageUrl, prompt, styleId, emoji, packageId } = req.body || {};

      if (!type) {
        return res.status(400).json({
          error: 'Bad request',
          message: 'type is required'
        });
      }

      const result = await container.useCases.createGenerationJob.execute({
        userId,
        type,
        imageUrl,
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
          result: job.result
        }
      };

      if (sticker && job.status === 'completed') {
        response.sticker = {
          id: sticker.id,
          packageId: sticker.packageId,
          name: sticker.name,
          imageUrl: sticker.imageUrl,
          thumbnailUrl: sticker.thumbnailUrl,
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
        jobs: result.jobs.map(job => ({
          id: job.id,
          status: job.status,
          currentStep: job.currentStep,
          progress: job.progress,
          stickerId: job.stickerId,
          type: job.type,
          errorMessage: job.errorMessage,
          result: job.result,
          createdAt: job.createdAt,
          updatedAt: job.updatedAt
        }))
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

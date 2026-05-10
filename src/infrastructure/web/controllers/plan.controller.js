import { container } from '../../../config/container.js';

/**
 * Plan Controller
 * Handles purchase plan endpoints
 */
export class PlanController {
  /**
   * Get All Plans
   * GET /api/v1/plans
   */
  static async getPlans(req, res) {
    try {
      const plans = container.services.plan.getAllPlans();
      
      res.json({
        success: true,
        plans: plans.map(p => ({
          id: p.productId,
          productId: p.productId,
          name: p.name,
          stickerCount: p.stickerCount,
          // Add pricing info here if needed
        }))
      });
    } catch (error) {
      console.error('Get plans failed:', error);
      res.status(500).json({
        error: 'Failed to retrieve plans',
        message: error.message
      });
    }
  }
}

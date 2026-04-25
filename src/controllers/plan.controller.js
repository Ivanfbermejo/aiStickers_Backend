import { PlanService } from "../services/plan.service.js";

/**
 * Controller para operaciones de planes de compra
 * Maneja el endpoint de listado de planes disponibles
 */

export const PlanController = {
  
  /**
   * GET /api/v1/plans
   * Obtiene los planes de compra disponibles
   * Los precios reales se obtienen del Google Play / App Store SDK
   */
  async getPlans(req, res) {
    console.log("📋 [PlanController] Get plans endpoint llamado");
    
    // Detectar plataforma del header (opcional, default android)
    const platform = req.headers['x-platform'] || 'android';
    
    try {
      // Usar PlanService para obtener planes
      const result = PlanService.getPlans(platform);
      
      res.json(result);
    } catch (error) {
      console.error("❌ [PlanController] Error getting plans:", error.message);
      res.status(500).json({ 
        success: false, 
        error: "Failed to get plans",
        message: error.message 
      });
    }
  }
};

import { UserAssetsService } from "../services/userAssets.service.js";

/**
 * Controller para gestionar assets del usuario
 * Stickers, paquetes, y recuperación de datos al login
 */

export const UserAssetsController = {
  
  /**
   * GET /api/v1/users/me/assets
   * Obtiene todos los assets del usuario autenticado
   * Se llama al iniciar sesión para recuperar datos
   */
  async getMyAssets(req, res) {
    try {
      const userId = req.user?.sub;
      if (!userId) {
        return res.status(401).json({
          success: false,
          error: "User not authenticated"
        });
      }
      
      const assets = await UserAssetsService.getUserAssets(userId);
      const balance = await BalanceService.getBalance(userId);
      
      res.json({
        success: true,
        userId,
        balance,
        ...assets
      });
      
    } catch (error) {
      console.error("❌ [UserAssetsController] Error getting assets:", error);
      res.status(500).json({
        success: false,
        error: "Failed to retrieve user assets"
      });
    }
  },
  
  /**
   * GET /api/v1/users/me/stickers
   * Obtiene stickers del usuario
   */
  async getMyStickers(req, res) {
    try {
      const userId = req.user?.sub;
      const limit = parseInt(req.query.limit) || 50;
      
      if (!userId) {
        return res.status(401).json({
          success: false,
          error: "User not authenticated"
        });
      }
      
      const stickers = await UserAssetsService.getStickers(userId, limit);
      
      res.json({
        success: true,
        userId,
        count: stickers.length,
        stickers
      });
      
    } catch (error) {
      console.error("❌ [UserAssetsController] Error getting stickers:", error);
      res.status(500).json({
        success: false,
        error: "Failed to retrieve stickers"
      });
    }
  },
  
  /**
   * POST /api/v1/users/me/stickers
   * Guarda un nuevo sticker
   */
  async saveSticker(req, res) {
    try {
      const userId = req.user?.sub;
      if (!userId) {
        return res.status(401).json({
          success: false,
          error: "User not authenticated"
        });
      }
      
      const { url, prompt, style, metadata } = req.body;
      
      if (!url) {
        return res.status(400).json({
          success: false,
          error: "Sticker URL is required"
        });
      }
      
      const sticker = await UserAssetsService.saveSticker(userId, {
        url,
        prompt,
        style,
        metadata
      });
      
      res.json({
        success: true,
        userId,
        sticker
      });
      
    } catch (error) {
      console.error("❌ [UserAssetsController] Error saving sticker:", error);
      res.status(500).json({
        success: false,
        error: "Failed to save sticker"
      });
    }
  },
  
  /**
   * DELETE /api/v1/users/me/stickers/:stickerId
   * Elimina un sticker
   */
  async deleteSticker(req, res) {
    try {
      const userId = req.user?.sub;
      const { stickerId } = req.params;
      
      if (!userId) {
        return res.status(401).json({
          success: false,
          error: "User not authenticated"
        });
      }
      
      const deleted = await UserAssetsService.deleteSticker(userId, stickerId);
      
      if (!deleted) {
        return res.status(404).json({
          success: false,
          error: "Sticker not found"
        });
      }
      
      res.json({
        success: true,
        userId,
        stickerId,
        message: "Sticker deleted successfully"
      });
      
    } catch (error) {
      console.error("❌ [UserAssetsController] Error deleting sticker:", error);
      res.status(500).json({
        success: false,
        error: "Failed to delete sticker"
      });
    }
  },
  
  /**
   * GET /api/v1/users/me/packages
   * Obtiene paquetes comprados
   */
  async getMyPackages(req, res) {
    try {
      const userId = req.user?.sub;
      
      if (!userId) {
        return res.status(401).json({
          success: false,
          error: "User not authenticated"
        });
      }
      
      const packages = await UserAssetsService.getPackages(userId);
      
      res.json({
        success: true,
        userId,
        count: packages.length,
        packages
      });
      
    } catch (error) {
      console.error("❌ [UserAssetsController] Error getting packages:", error);
      res.status(500).json({
        success: false,
        error: "Failed to retrieve packages"
      });
    }
  }
};

// Importar BalanceService para getMyAssets
import { BalanceService } from "../services/balance.simple.service.js";

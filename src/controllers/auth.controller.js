import jwt from 'jsonwebtoken';
import { OAuth2Client } from 'google-auth-library';
import { env } from '../utils/env.js';

/**
 * Controller para autenticación social (Google, Apple)
 * Maneja verificación de tokens y generación de JWT propios
 */

export const AuthController = {
  
  /**
   * POST /api/v1/auth/google
   * Verifica ID token de Google y genera JWT propio
   */
  async googleAuth(req, res) {
    console.log("🔍 [GOOGLE_AUTH] Google authentication endpoint llamado");
    
    const { idToken } = req.body;
    if (!idToken) {
      return res.status(400).json({
        success: false,
        error: "Google ID token is required"
      });
    }
    
    try {
      const googleClientId = env.GOOGLE_CLIENT_ID;
      if (!googleClientId) {
        console.error("❌ [GOOGLE_AUTH] GOOGLE_CLIENT_ID no configurado en .env");
        return res.status(500).json({
          success: false,
          error: "Server configuration error"
        });
      }
      
      const client = new OAuth2Client(googleClientId);
      
      // Verificar el token con Google
      const ticket = await client.verifyIdToken({
        idToken: idToken,
        audience: googleClientId
      });
      
      const payload = ticket.getPayload();
      
      if (!payload) {
        return res.status(401).json({
          success: false,
          error: "Invalid Google token"
        });
      }
      
      const googleUser = {
        sub: payload.sub,
        email: payload.email,
        name: payload.name,
        picture: payload.picture,
        emailVerified: payload.email_verified
      };
      
      console.log("✅ [GOOGLE_AUTH] Usuario verificado:", googleUser.email);
      
      // Generar JWT propio para el usuario
      const userToken = jwt.sign(
        { 
          sub: googleUser.sub,
          email: googleUser.email,
          name: googleUser.name,
          provider: 'google',
          emailVerified: googleUser.emailVerified
        },
        process.env.JWT_SECRET || 'your-secret-key',
        { expiresIn: '24h' }
      );
      
      res.json({
        success: true,
        user: googleUser,
        token: userToken,
        message: "Google authentication successful"
      });
      
    } catch (error) {
      console.error("❌ [GOOGLE_AUTH] Error verificando token:", error.message);
      res.status(401).json({
        success: false,
        error: "Invalid Google token",
        details: error.message
      });
    }
  },

  /**
   * POST /api/v1/auth/apple
   * Verifica identity token de Apple (placeholder para futura implementación)
   */
  async appleAuth(req, res) {
    console.log("🍎 [APPLE_AUTH] Apple authentication endpoint llamado");
    
    const { identityToken, userInfo } = req.body;
    if (!identityToken) {
      return res.status(400).json({
        success: false,
        error: "Apple identity token is required"
      });
    }
    
    // TODO: Implementar verificación real con Apple
    // Por ahora devolvemos error indicando que no está implementado
    res.status(501).json({
      success: false,
      error: "Apple Sign-In not yet implemented",
      message: "This endpoint is reserved for future iOS integration"
    });
  },

  /**
   * POST /api/v1/auth/logout
   * Logout del usuario - invalida el token actual
   */
  async logout(req, res) {
    try {
      const userId = req.user?.sub;
      
      if (!userId) {
        return res.status(401).json({
          success: false,
          error: "User not authenticated"
        });
      }
      
      // En el futuro: añadir token a blacklist para invalidarlo
      // Por ahora el frontend debe borrar el token localmente
      
      console.log(`👋 [LOGOUT] User ${userId} logged out`);
      
      res.json({
        success: true,
        message: "Logged out successfully",
        timestamp: new Date().toISOString()
      });
      
    } catch (error) {
      console.error("❌ [LOGOUT] Error:", error);
      res.status(500).json({
        success: false,
        error: "Logout failed"
      });
    }
  },

  /**
   * POST /api/v1/auth/refresh
   * Renueva el JWT antes de que expire
   */
  async refreshToken(req, res) {
    try {
      const userId = req.user?.sub;
      const email = req.user?.email;
      const name = req.user?.name;
      
      if (!userId) {
        return res.status(401).json({
          success: false,
          error: "User not authenticated"
        });
      }
      
      // Generar nuevo JWT con 24h adicionales
      const newToken = jwt.sign(
        { 
          sub: userId,
          email: email,
          name: name,
          provider: req.user?.provider || 'unknown',
          refreshed: true
        },
        process.env.JWT_SECRET || 'your-secret-key',
        { expiresIn: '24h' }
      );
      
      console.log(`🔄 [REFRESH] Token refreshed for user ${userId}`);
      
      res.json({
        success: true,
        token: newToken,
        expiresIn: '24h',
        message: "Token refreshed successfully"
      });
      
    } catch (error) {
      console.error("❌ [REFRESH] Error:", error);
      res.status(500).json({
        success: false,
        error: "Token refresh failed"
      });
    }
  },

  /**
   * GET /api/v1/auth/me
   * Valida el token actual y devuelve info del usuario
   */
  async validateSession(req, res) {
    try {
      const userId = req.user?.sub;
      const email = req.user?.email;
      const name = req.user?.name;
      
      if (!userId) {
        return res.status(401).json({
          success: false,
          error: "Invalid or expired token"
        });
      }
      
      res.json({
        success: true,
        user: {
          sub: userId,
          email: email,
          name: name
        },
        valid: true,
        timestamp: new Date().toISOString()
      });
      
    } catch (error) {
      console.error("❌ [VALIDATE] Error:", error);
      res.status(401).json({
        success: false,
        error: "Token validation failed"
      });
    }
  }
};

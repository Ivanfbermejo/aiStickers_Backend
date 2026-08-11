import { container } from '../../../config/container.js';
import { getLogger } from '../../observability/logger.js';

/**
 * Auth Controller
 * Handles authentication endpoints
 */
export class AuthController {
  /**
   * Generate App Token (HMAC authenticated)
   * POST /api/v1/auth/token
   */
  static async generateAppToken(req, res) {
    try {
      const token = container.services.jwt.generateAppToken();

      res.json({
        token,
        expiresIn: '24h'
      });
    } catch (error) {
      getLogger().error({ err: error }, 'App token generation failed:');
      res.status(500).json({ error: 'Token generation failed' });
    }
  }
  
  /**
   * Google Sign-In
   * POST /api/v1/auth/google
   */
  static async googleAuth(req, res) {
    try {
      const { idToken } = req.body;
      
      if (!idToken) {
        return res.status(400).json({ 
          error: 'Missing idToken',
          message: 'Google ID token is required' 
        });
      }
      
      const result = await container.useCases.authenticateGoogle.execute({
        idToken
      });

      const session = await container.services.session.createSession({
        userId: result.user.id,
        metadata: { userAgent: req.headers['user-agent'], ip: req.ip }
      });

      res.json({
        success: true,
        token: session.accessToken,
        refreshToken: session.refreshToken,
        expiresIn: session.expiresIn,
        user: result.user
      });
    } catch (error) {
      getLogger().error({ err: error }, 'Google authentication failed:');
      res.status(401).json({ 
        error: 'Authentication failed',
        message: error.message 
      });
    }
  }
  
  /**
   * Validate Session
   * GET /api/v1/auth/me
   */
  static async validateSession(req, res) {
    try {
      res.json({
        valid: true,
        user: {
          id: req.user.sub,
          email: req.user.email,
          name: req.user.name
        }
      });
    } catch (error) {
      res.status(401).json({ error: 'Invalid session' });
    }
  }
  
  /**
   * Refresh Token
   * POST /api/v1/auth/refresh
   */
  static async refreshToken(req, res) {
    try {
      const { refreshToken } = req.body || {};
      if (!refreshToken) {
        return res.status(401).json({
          error: 'Missing refresh token',
          message: 'refreshToken is required in body'
        });
      }

      const session = await container.services.session.rotateRefreshToken(refreshToken);

      res.json({
        success: true,
        token: session.accessToken,
        refreshToken: session.refreshToken,
        expiresIn: session.expiresIn
      });
    } catch (error) {
      getLogger().error({ err: error }, 'Token refresh failed:');
      res.status(401).json({
        error: 'Token refresh failed',
        message: 'Invalid, expired or revoked refresh token'
      });
    }
  }

  /**
   * Logout
   * POST /api/v1/auth/logout
   */
  static async logout(req, res) {
    try {
      const { refreshToken } = req.body || {};
      if (refreshToken) {
        await container.services.session.revokeSession(refreshToken);
      }
      res.json({ success: true, message: 'Logged out' });
    } catch (error) {
      getLogger().error({ err: error }, 'Logout failed:');
      res.status(500).json({ error: 'Logout failed' });
    }
  }
}

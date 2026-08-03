import { container } from '../../../config/container.js';

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
      console.error('App token generation failed:', error);
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
      console.error('Google authentication failed:', error);
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
      console.error('Token refresh failed:', error);
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
      console.error('Logout failed:', error);
      res.status(500).json({ error: 'Logout failed' });
    }
  }
}

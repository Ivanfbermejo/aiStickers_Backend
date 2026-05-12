import jwt from 'jsonwebtoken';
import { env } from '../../../config/env.js';
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
      const token = jwt.sign(
        { sub: 'app', type: 'app', scope: ['stickers'] },
        env.JWT_SECRET,
        { expiresIn: '24h' }
      );
      
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
      
      res.json({
        success: true,
        token: result.token,
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
      const authHeader = req.headers.authorization;
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ 
          error: 'Missing token',
          message: 'Authorization Bearer token is required' 
        });
      }
      
      const token = authHeader.substring(7);
      
      // Verify token (allow expired for refresh)
      let decoded;
      try {
        decoded = jwt.verify(token, env.JWT_SECRET, { ignoreExpiration: true });
      } catch (error) {
        return res.status(401).json({ 
          error: 'Invalid token',
          message: 'Token is malformed or invalid' 
        });
      }
      
      // Ensure it's a user token (not app token)
      if (decoded.type !== 'user') {
        return res.status(401).json({ 
          error: 'Invalid token type',
          message: 'Only user tokens can be refreshed' 
        });
      }
      
      // Generate new token with same claims but fresh timestamps
      // Remove exp and iat from decoded to avoid JWT conflicts
      const { exp, iat, ...payload } = decoded;
      const newToken = jwt.sign(
        payload,
        env.JWT_SECRET,
        { expiresIn: '7d' }
      );
      
      res.json({
        success: true,
        token: newToken,
        expiresIn: '7d'
      });
    } catch (error) {
      console.error('Token refresh failed:', error);
      res.status(500).json({ 
        error: 'Token refresh failed',
        message: 'Internal server error' 
      });
    }
  }
  
  /**
   * Logout
   * POST /api/v1/auth/logout
   */
  static async logout(req, res) {
    // In JWT-based auth, logout is handled client-side
    // Server can optionally blacklist tokens if needed
    res.json({ success: true, message: 'Logged out' });
  }
}

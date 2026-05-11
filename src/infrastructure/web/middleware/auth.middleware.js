import { JwtService } from '../../auth/jwt.service.js';

/**
 * JWT Authentication Middleware
 * Verifies user JWT tokens
 */
export class AuthMiddleware {
  constructor() {
    this.jwtService = new JwtService();
  }
  
  /**
   * Verify any valid JWT (App or User token)
   */
  verifyToken(req, res, next) {
    try {
      const authHeader = req.headers.authorization || '';
      
      if (!authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ 
          error: 'Missing bearer token',
          message: 'Request must include JWT token' 
        });
      }
      
      const token = authHeader.substring(7);
      const decoded = this.jwtService.verify(token);
      
      // Attach user info to request
      req.user = decoded;
      
      return next();
    } catch (error) {
      return res.status(401).json({ 
        error: 'Invalid token',
        message: error.message 
      });
    }
  }
  
  /**
   * Verify User JWT only (not App Token)
   * Required for user-specific operations
   */
  verifyUserToken(req, res, next) {
    console.log('🔐 verifyUserToken called for:', req.path);
    try {
      const authHeader = req.headers.authorization || '';
      
      if (!authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ 
          error: 'Missing bearer token',
          message: 'User authentication required' 
        });
      }
      
      const token = authHeader.substring(7);
      const decoded = this.jwtService.verify(token);
      
      // Reject App Tokens
      if (decoded.type === 'app' || decoded.sub === 'app') {
        return res.status(401).json({ 
          error: 'User authentication required',
          message: 'App tokens cannot access user resources' 
        });
      }
      
      // Validate user identifier
      if (!decoded.sub || decoded.sub === '' || decoded.sub === 'null') {
        return res.status(401).json({ 
          error: 'Invalid user token',
          message: 'User identifier missing' 
        });
      }
      
      // Attach user info
      req.user = decoded;
      
      return next();
    } catch (error) {
      return res.status(401).json({ 
        error: 'Invalid token',
        message: error.message 
      });
    }
  }
  
  /**
   * Express middleware factories
   */
  requireAuth() {
    return (req, res, next) => this.verifyToken(req, res, next);
  }
  
  requireUser() {
    return (req, res, next) => this.verifyUserToken(req, res, next);
  }
}

// Singleton instance
export const authMiddleware = new AuthMiddleware();
export const requireAuth = authMiddleware.requireAuth();
export const requireUser = authMiddleware.requireUser();

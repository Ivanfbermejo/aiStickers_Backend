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
      console.log('🔐 authHeader:', authHeader ? 'present' : 'missing');
      
      if (!authHeader.startsWith('Bearer ')) {
        console.log('❌ No Bearer token found');
        return res.status(401).json({ 
          error: 'Missing bearer token',
          message: 'User authentication required' 
        });
      }
      
      const token = authHeader.substring(7);
      console.log('🔐 token length:', token.length);
      
      // Try to verify with expiration check first
      let decoded;
      try {
        decoded = this.jwtService.verify(token);
      } catch (expError) {
        // If expired, try again ignoring expiration
        console.log('🔐 Token expired, trying without expiration check...');
        decoded = this.jwtService.verifyWithoutExpiration(token);
        console.log('🔐 decoded expired token:', decoded);
        
        // Check if it's too old (more than 7 days)
        const now = Math.floor(Date.now() / 1000);
        if (decoded.exp && (now - decoded.exp) > 604800) {
          console.log('❌ Token too old (>7d)');
          return res.status(401).json({ 
            error: 'Token expired',
            message: 'Please login again' 
          });
        }
      }
      
      console.log('🔐 decoded token:', decoded);
      
      // Reject App Tokens
      if (decoded.type === 'app' || decoded.sub === 'app') {
        console.log('❌ App token rejected');
        return res.status(401).json({ 
          error: 'User authentication required',
          message: 'App tokens cannot access user resources' 
        });
      }
      
      // Validate user identifier
      if (!decoded.sub || decoded.sub === '' || decoded.sub === 'null') {
        console.log('❌ Invalid user identifier');
        return res.status(401).json({ 
          error: 'Invalid user token',
          message: 'User identifier missing' 
        });
      }
      
      console.log('✅ Token validation successful, calling next()');
      
      // Attach user info
      req.user = decoded;
      
      return next();
    } catch (error) {
      console.log('❌ JWT verification failed:', error.message);
      console.log('❌ Full error:', error);
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

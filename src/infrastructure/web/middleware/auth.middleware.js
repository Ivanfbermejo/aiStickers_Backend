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
      let decoded;

      try {
        decoded = this.jwtService.verify(token);
      } catch (error) {
        // If real verification fails, allow configured test JWTs
        if (this.jwtService.isTestJwt(token)) {
          decoded = this.jwtService.decodeTestJwt(token);
          if (!decoded) {
            throw new Error('Invalid test token');
          }
        } else {
          throw error;
        }
      }
      
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
      
      // Try to verify with expiration check first
      let decoded;
      try {
        decoded = this.jwtService.verify(token);
      } catch (expError) {
        try {
          // If expired, try again ignoring expiration
          decoded = this.jwtService.verifyWithoutExpiration(token);
          
          // Check if it's too old (more than 7 days)
          const now = Math.floor(Date.now() / 1000);
          if (decoded.exp && (now - decoded.exp) > 604800) {
            console.log('❌ Token too old (>7d)');
            return res.status(401).json({ 
              error: 'Token expired',
              message: 'Please login again' 
            });
          }
        } catch (verifyError) {
          // Allow configured test JWTs without signature verification
          if (this.jwtService.isTestJwt(token)) {
            decoded = this.jwtService.decodeTestJwt(token);
            if (!decoded) {
              throw new Error('Invalid test token');
            }
          } else {
            throw verifyError;
          }
        }
      }
      
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

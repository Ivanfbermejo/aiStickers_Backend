import jwt from 'jsonwebtoken';
import { env } from '../../config/env.js';

/**
 * JWT Service
 * Handles token generation and verification
 */
export class JwtService {
  constructor() {
    this.secret = env.JWT_SECRET;
    this.expiresIn = env.JWT_EXPIRES_IN || '24h';
    this.testJwts = env.TEST_JWTS || [];
  }

  /**
   * Check if the provided token is a configured test JWT.
   * @param {string} token - JWT token
   * @returns {boolean}
   */
  isTestJwt(token) {
    return this.testJwts.includes(token);
  }

  /**
   * Decode a test JWT without signature verification.
   * @param {string} token - JWT token
   * @returns {Object|null} Decoded payload
   */
  decodeTestJwt(token) {
    return jwt.decode(token);
  }
  
  /**
   * Generate App Token (for HMAC authenticated requests without user)
   * @returns {string} JWT token
   */
  generateAppToken() {
    return jwt.sign(
      { 
        sub: 'app',
        type: 'app',
        scope: ['stickers']
      },
      this.secret,
      { expiresIn: this.expiresIn }
    );
  }
  
  /**
   * Generate User Token (after Google authentication)
   * @param {Object} userInfo - User information
   * @returns {string} JWT token
   */
  generateUserToken({ sub, email, name, googleId }) {
    return jwt.sign(
      {
        sub, // User ID (email)
        email,
        name,
        googleId,
        type: 'user',
        scope: ['stickers']
      },
      this.secret,
      { expiresIn: this.expiresIn }
    );
  }
  
  /**
   * Verify JWT token
   * @param {string} token - JWT token
   * @returns {Object} Decoded token
   */
  verify(token) {
    try {
      return jwt.verify(token, this.secret);
    } catch (error) {
      throw new Error('Invalid token');
    }
  }
  
  /**
   * Verify JWT token ignoring expiration
   * @param {string} token - JWT token
   * @returns {Object} Decoded token
   */
  verifyWithoutExpiration(token) {
    try {
      return jwt.verify(token, this.secret, { ignoreExpiration: true });
    } catch (error) {
      throw new Error('Invalid token');
    }
  }
  
  /**
   * Decode token without verification
   * @param {string} token - JWT token
   * @returns {Object} Decoded payload
   */
  decode(token) {
    return jwt.decode(token);
  }
}

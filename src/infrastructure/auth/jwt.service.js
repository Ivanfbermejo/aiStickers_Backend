import jwt from 'jsonwebtoken';
import { randomBytes, randomUUID } from 'node:crypto';
import { env } from '../../config/env.js';

/**
 * JWT Service
 * Handles access token generation and strict verification.
 */
export class JwtService {
  constructor() {
    this.secret = env.JWT_SECRET;
    this.issuer = env.JWT_ISSUER;
    this.audience = env.JWT_AUDIENCE;
    this.testJwts = env.TEST_JWTS || [];
  }

  _verifyOptions() {
    return {
      algorithms: ['HS256'],
      issuer: this.issuer,
      audience: this.audience
    };
  }

  /**
   * Check if the provided token is a configured test JWT.
   * Only allowed when ENABLE_TEST_JWTS is true and never in production.
   * @param {string} token - JWT token
   * @returns {boolean}
   */
  isTestJwt(token) {
    return env.ENABLE_TEST_JWTS && this.testJwts.includes(token);
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
   * Generate an access token for the app client.
   * @returns {string} JWT access token
   */
  generateAppToken() {
    return jwt.sign(
      {
        jti: randomUUID(),
        sub: 'app',
        type: 'app',
        scope: ['stickers']
      },
      this.secret,
      { algorithm: 'HS256', issuer: this.issuer, audience: this.audience, expiresIn: '24h' }
    );
  }

  /**
   * Generate a short-lived access token for a user.
   * @param {Object} userInfo
   * @param {string} userInfo.sub - User identifier
   * @param {string} [userInfo.email]
   * @param {string} [userInfo.name]
   * @param {string} [userInfo.googleId]
   * @returns {string} JWT access token
   */
  generateAccessToken({ sub, email, name, googleId }) {
    return jwt.sign(
      {
        jti: randomUUID(),
        sub,
        email,
        name,
        googleId,
        type: 'user',
        scope: ['stickers']
      },
      this.secret,
      { algorithm: 'HS256', issuer: this.issuer, audience: this.audience, expiresIn: '15m' }
    );
  }

  /**
   * Strictly verify an access token: algorithm, issuer, audience and expiration.
   * In test/development mode configured test JWTs are accepted as a fallback.
   * @param {string} token - JWT access token
   * @returns {Object} Decoded token
   */
  verify(token) {
    try {
      return jwt.verify(token, this.secret, this._verifyOptions());
    } catch (error) {
      if (this.isTestJwt(token)) {
        const decoded = this.decodeTestJwt(token);
        if (!decoded) {
          throw new Error('Invalid test token');
        }
        return decoded;
      }
      throw new Error('Invalid token');
    }
  }

  /**
   * Decode token without verification.
   * @param {string} token - JWT token
   * @returns {Object} Decoded token
   */
  decode(token) {
    return jwt.decode(token);
  }
}

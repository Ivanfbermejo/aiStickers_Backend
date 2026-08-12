import { OAuth2Client } from 'google-auth-library';
import { env } from '../../config/env.js';
import { getLogger } from '../observability/logger.js';

/**
 * Google Authentication Service
 * Verifies Google ID tokens
 */
export class GoogleAuthService {
  constructor() {
    this.client = new OAuth2Client(env.GOOGLE_CLIENT_ID);
  }
  
  /**
   * Verify Google ID token
   * @param {string} idToken - Google ID token from mobile app
   * @returns {Object} Google profile info
   */
  async verifyIdToken(idToken) {
    try {
      const ticket = await this.client.verifyIdToken({
        idToken,
        audience: env.GOOGLE_CLIENT_ID
      });
      
      const payload = ticket.getPayload();

      if (!payload.email_verified) {
        throw new Error('Google email not verified');
      }

      return {
        sub: payload.sub, // Google unique ID (immutable identifier)
        email: payload.email,
        name: payload.name,
        picture: payload.picture,
        emailVerified: payload.email_verified
      };
    } catch (error) {
      getLogger().error({ err: error }, 'Google token verification failed:');
      throw new Error('Invalid Google token');
    }
  }
}

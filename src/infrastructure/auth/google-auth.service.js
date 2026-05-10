import { OAuth2Client } from 'google-auth-library';
import { env } from '../../config/env.js';

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
      
      return {
        sub: payload.sub, // Google unique ID
        email: payload.email,
        name: payload.name,
        picture: payload.picture,
        emailVerified: payload.email_verified
      };
    } catch (error) {
      console.error('Google token verification failed:', error);
      throw new Error('Invalid Google token');
    }
  }
}

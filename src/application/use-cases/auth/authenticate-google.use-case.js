import { User } from '../../../domain/entities/user.entity.js';

/**
 * Authenticate with Google Use Case
 * Handles Google Sign-In and user creation/retrieval
 */
export class AuthenticateGoogleUseCase {
  constructor({
    userRepository,
    balanceRepository,
    googleAuthService
  }) {
    this.userRepository = userRepository;
    this.balanceRepository = balanceRepository;
    this.googleAuthService = googleAuthService;
  }
  
  /**
   * Execute Google authentication
   * @param {Object} input
   * @param {string} input.idToken - Google ID token
   * @returns {Object} Authentication result with JWT
   */
  async execute({ idToken }) {
    // 1. Verify Google token
    const googleProfile = await this.googleAuthService.verifyIdToken(idToken);
    
    // 2. Find or create user based on the immutable Google sub identity
    let user = await this.userRepository.findByGoogleId(googleProfile.sub);

    if (!user) {
      user = await this.userRepository.findByEmail(googleProfile.email);

      if (user) {
        // Link the Google identity to the existing email account only if it has no other Google id
        if (user.googleId && user.googleId !== googleProfile.sub) {
          throw new Error('Google identity conflict');
        }
        user.googleId = googleProfile.sub;
        await this.userRepository.update(user);
      } else {
        // Create new user from Google profile
        user = User.fromGoogleProfile(googleProfile);
        await this.userRepository.save(user);

        // Create initial balance
        await this.balanceRepository.createForUser(user.id);
      }
    }
    
    // 3. Return authenticated user; the caller creates the session and tokens
    return {
      user: {
        id: user.id,
        email: user.email,
        name: user.name
      }
    };
  }
}

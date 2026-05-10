import { User } from '../../../domain/entities/user.entity.js';

/**
 * Authenticate with Google Use Case
 * Handles Google Sign-In and user creation/retrieval
 */
export class AuthenticateGoogleUseCase {
  constructor({
    userRepository,
    balanceRepository,
    googleAuthService,
    jwtService
  }) {
    this.userRepository = userRepository;
    this.balanceRepository = balanceRepository;
    this.googleAuthService = googleAuthService;
    this.jwtService = jwtService;
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
    
    // 2. Find or create user
    let user = await this.userRepository.findByEmail(googleProfile.email);
    
    if (!user) {
      // Create new user from Google profile
      user = User.fromGoogleProfile(googleProfile);
      await this.userRepository.save(user);
      
      // Create initial balance
      await this.balanceRepository.createForUser(user.id);
    } else {
      // Update Google ID if not set
      if (!user.googleId && googleProfile.sub) {
        user.googleId = googleProfile.sub;
        await this.userRepository.update(user);
      }
    }
    
    // 3. Generate JWT
    const token = this.jwtService.generateUserToken({
      sub: user.id, // Use email as primary identifier
      email: user.email,
      name: user.name,
      googleId: user.googleId
    });
    
    // 4. Return result
    return {
      token,
      user: {
        id: user.id,
        email: user.email,
        name: user.name
      }
    };
  }
}

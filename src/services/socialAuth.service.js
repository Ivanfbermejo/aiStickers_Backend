import jwt from 'jsonwebtoken';
import fetch from 'node-fetch';

class SocialAuthService {
  constructor() {
    // Temporarily disabled until google-auth-library is installed
    this.googleClient = null;
    console.log("⚠️ Google Auth Library not installed - using mock verification");
  }

  /**
   * Autenticar con Google Sign-In
   */
  async authenticateWithGoogle(idToken) {
    try {
      // 1. Verificar token con Google (temporalmente mock hasta instalar google-auth-library)
      let userInfo;
      
      if (process.env.ENABLE_MOCK === 'true' || process.env.NODE_ENV === 'development') {
        // Mock verification para desarrollo
        userInfo = this.mockGoogleTokenVerification(idToken);
      } else {
        // Verificación real (descomentar cuando google-auth-library esté instalado)
        throw new Error("Google Auth Library not installed - Please run: npm install google-auth-library");
      }

      // 2. Buscar o crear usuario
      const user = await this.findOrCreateUser({
        id: userInfo.sub,
        email: userInfo.email,
        name: userInfo.name,
        picture: userInfo.picture,
        provider: 'google'
      });

      // 3. Generar nuestro JWT para pagos
      const paymentToken = this.generatePaymentJWT(user);

      return {
        success: true,
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          picture: user.picture
        },
        paymentToken,
        expiresIn: process.env.JWT_EXPIRES_IN || '15m'
      };

    } catch (error) {
      console.error('Google authentication error:', error);
      return {
        success: false,
        error: 'Invalid Google token'
      };
    }
  }

  /**
   * Autenticar con Apple Sign-In
   */
  async authenticateWithApple(identityToken, userInfo = {}) {
    try {
      // 1. Verificar token con Apple
      const decoded = jwt.decode(identityToken, { complete: true });
      
      if (!decoded) {
        throw new Error('Invalid Apple token');
      }

      // 2. Verificar issuer y audience
      if (decoded.payload.iss !== 'https://appleid.apple.com') {
        throw new Error('Invalid Apple token issuer');
      }

      if (decoded.payload.aud !== process.env.APPLE_CLIENT_ID) {
        throw new Error('Invalid Apple token audience');
      }

      // 3. Extraer información del usuario
      const appleUserInfo = {
        id: decoded.payload.sub,
        email: userInfo.email || decoded.payload.email,
        name: userInfo.name || `${decoded.payload.sub}_apple`,
        picture: null,
        provider: 'apple'
      };

      // 4. Crear o actualizar usuario en nuestro sistema
      const user = await this.findOrCreateUser(appleUserInfo);

      // 5. Generar nuestro JWT para pagos
      const paymentToken = this.generatePaymentJWT(user);

      return {
        success: true,
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          picture: user.picture
        },
        paymentToken,
        expiresIn: process.env.JWT_EXPIRES_IN || '15m'
      };

    } catch (error) {
      console.error('Apple authentication error:', error);
      return {
        success: false,
        error: 'Invalid Apple token'
      };
    }
  }

  /**
   * Crear o encontrar usuario en nuestro sistema
   */
  async findOrCreateUser(userInfo) {
    // En implementación real, esto conectaría a tu base de datos
    // Por ahora simulamos la creación/ búsqueda
    
    const existingUser = await this.findUserByProviderId(userInfo.id, userInfo.provider);
    
    if (existingUser) {
      // Actualizar última fecha de login
      await this.updateUserLastLogin(existingUser.id);
      return existingUser;
    }

    // Crear nuevo usuario
    const newUser = await this.createUser({
      id: `user_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      providerId: userInfo.id,
      provider: userInfo.provider,
      email: userInfo.email,
      name: userInfo.name,
      picture: userInfo.picture,
      createdAt: new Date(),
      lastLoginAt: new Date(),
      isActive: true
    });

    return newUser;
  }

  /**
   * Generar JWT para pagos
   */
  generatePaymentJWT(user) {
    const payload = {
      sub: user.id, // Subject = ID de nuestro usuario
      email: user.email,
      name: user.name,
      provider: user.provider,
      scope: ['payments', 'stickers'],
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + (15 * 60) // 15 minutos
    };

    return jwt.sign(payload, process.env.JWT_SECRET, {
      algorithm: 'HS256'
    });
  }

  /**
   * Verificar nuestro JWT de pagos
   */
  verifyPaymentJWT(token) {
    try {
      return jwt.verify(token, process.env.JWT_SECRET, {
        algorithms: ['HS256']
      });
    } catch (error) {
      throw new Error('Invalid payment token');
    }
  }

  // Métodos simulados para base de datos
  async findUserByProviderId(providerId, provider) {
    // Simular búsqueda en base de datos
    // En implementación real: SELECT * FROM users WHERE provider_id = ? AND provider = ?
    return null; // Simulamos que no existe para crear nuevo
  }

  async createUser(userData) {
    // Simular creación en base de datos
    // En implementación real: INSERT INTO users ...
    console.log(`Creating user: ${userData.email} from ${userData.provider}`);
    return userData;
  }

  async updateUserLastLogin(userId) {
    // Simular actualización en base de datos
    // En implementación real: UPDATE users SET last_login_at = NOW() WHERE id = ?
    console.log(`Updating last login for user: ${userId}`);
  }

  /**
   * Mock verification para desarrollo
   */
  mockGoogleTokenVerification(idToken) {
    // Simular payload de Google token
    return {
      sub: 'google_mock_user_1',
      email: 'test.user@gmail.com',
      name: 'Test User',
      picture: 'https://via.placeholder.com/150/150/4285F4/FFFFFF?text=Test',
      email_verified: true,
      iss: 'https://accounts.google.com',
      aud: process.env.GOOGLE_CLIENT_ID,
      exp: Math.floor(Date.now() / 1000) + 3600
    };
  }
}

export const socialAuthService = new SocialAuthService();

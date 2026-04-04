import jwt from 'jsonwebtoken';
import crypto from 'crypto';

class GoogleMockService {
  constructor() {
    this.mockUsers = new Map();
    this.mockClientId = process.env.GOOGLE_CLIENT_ID || 'test-google-client-id.apps.googleusercontent.com';
    this.initMockUsers();
  }

  /**
   * Inicializar usuarios de prueba
   */
  initMockUsers() {
    const testUsers = [
      {
        id: 'google_mock_user_1',
        email: 'test.user@gmail.com',
        name: 'Test User',
        picture: 'https://via.placeholder.com/150/150/4285F4/FFFFFF?text=Test',
        password: 'test123'
      },
      {
        id: 'google_mock_user_2', 
        email: 'developer@gmail.com',
        name: 'Developer User',
        picture: 'https://via.placeholder.com/150/150/4285F4/FFFFFF?text=Dev',
        password: 'dev123'
      },
      {
        id: 'google_mock_user_3',
        email: 'premium.user@gmail.com',
        name: 'Premium User',
        picture: 'https://via.placeholder.com/150/150/4285F4/FFFFFF?text=Premium',
        password: 'premium123'
      }
    ];

    testUsers.forEach(user => {
      this.mockUsers.set(user.email, user);
    });
  }

  /**
   * Generar un ID Token válido (simulando Google)
   */
  generateMockIdToken(user) {
    const now = Math.floor(Date.now() / 1000);
    const payload = {
      iss: 'https://accounts.google.com',
      azp: this.mockClientId,
      aud: this.mockClientId,
      sub: user.id,
      email: user.email,
      email_verified: true,
      name: user.name,
      picture: user.picture,
      given_name: user.name.split(' ')[0],
      family_name: user.name.split(' ')[1] || '',
      locale: 'en',
      iat: now,
      exp: now + 3600, // 1 hora de expiración
      jti: crypto.randomUUID()
    };

    // Firmar con una clave simulada (en producción sería la clave real de Google)
    const mockPrivateKey = 'mock_google_private_key_for_testing_only';
    return jwt.sign(payload, mockPrivateKey, { algorithm: 'HS256' });
  }

  /**
   * Verificar un mock ID Token
   */
  verifyMockIdToken(idToken) {
    try {
      const mockPrivateKey = 'mock_google_private_key_for_testing_only';
      const decoded = jwt.verify(idToken, mockPrivateKey, { algorithms: ['HS256'] });
      
      return {
        valid: true,
        payload: decoded
      };
    } catch (error) {
      return {
        valid: false,
        error: error.message
      };
    }
  }

  /**
   * Endpoint mock de Google OAuth 2.0 Authorization
   */
  handleMockAuthRequest(req, res) {
    const { response_type, client_id, redirect_uri, scope, state } = req.query;

    // Simular pantalla de consentimiento de Google
    const authPage = `
    <!DOCTYPE html>
    <html>
    <head>
        <title>Mock Google Sign-In</title>
        <style>
            body { font-family: Arial, sans-serif; max-width: 400px; margin: 100px auto; padding: 20px; }
            .google-header { text-align: center; margin-bottom: 30px; }
            .user-list { margin: 20px 0; }
            .user-option { 
                border: 1px solid #ddd; 
                padding: 15px; 
                margin: 10px 0; 
                cursor: pointer; 
                border-radius: 8px;
                display: flex;
                align-items: center;
                gap: 15px;
            }
            .user-option:hover { background-color: #f8f9fa; }
            .user-avatar { width: 40px; height: 40px; border-radius: 50%; }
            .user-info { flex: 1; }
            .user-name { font-weight: bold; margin-bottom: 5px; }
            .user-email { color: #666; font-size: 14px; }
            .cancel-btn { 
                background: none; 
                border: none; 
                color: #1a73e8; 
                cursor: pointer; 
                padding: 10px;
                text-decoration: none;
                display: inline-block;
                margin-top: 20px;
            }
        </style>
    </head>
    <body>
        <div class="google-header">
            <h2>Mock Google Sign-In</h2>
            <p>Selecciona una cuenta de prueba para continuar:</p>
        </div>
        
        <div class="user-list">
            ${Array.from(this.mockUsers.values()).map(user => `
                <div class="user-option" onclick="selectUser('${user.email}')">
                    <img src="${user.picture}" alt="${user.name}" class="user-avatar">
                    <div class="user-info">
                        <div class="user-name">${user.name}</div>
                        <div class="user-email">${user.email}</div>
                    </div>
                </div>
            `).join('')}
        </div>
        
        <a href="${redirect_uri}?error=access_denied&state=${state}" class="cancel-btn">
            Cancelar
        </a>
        
        <script>
            function selectUser(email) {
                const form = document.createElement('form');
                form.method = 'POST';
                form.action = '/mock/google/select-user';
                
                form.innerHTML = \`
                    <input type="hidden" name="email" value="\${email}">
                    <input type="hidden" name="redirect_uri" value="\${encodeURIComponent('${redirect_uri}')}">
                    <input type="hidden" name="state" value="\${encodeURIComponent('${state}')}">
                    <input type="hidden" name="client_id" value="\${encodeURIComponent('${client_id}')}">
                \`;
                
                document.body.appendChild(form);
                form.submit();
            }
        </script>
    </body>
    </html>`;

    res.setHeader('Content-Type', 'text/html');
    res.send(authPage);
  }

  /**
   * Manejar selección de usuario mock
   */
  handleMockUserSelection(req, res) {
    const { email, redirect_uri, state, client_id } = req.body;
    
    const user = this.mockUsers.get(email);
    if (!user) {
      return res.redirect(`${redirect_uri}?error=invalid_user&state=${state}`);
    }

    // Generar authorization code
    const authCode = crypto.randomBytes(32).toString('hex');
    
    // Guardar auth code temporalmente
    this.tempAuthCodes = this.tempAuthCodes || new Map();
    this.tempAuthCodes.set(authCode, {
      user,
      expiresAt: Date.now() + 10 * 60 * 1000 // 10 minutos
    });

    res.redirect(`${redirect_uri}?code=${authCode}&state=${state}`);
  }

  /**
   * Endpoint mock de Google OAuth 2.0 Token Exchange
   */
  handleMockTokenExchange(req, res) {
    const { grant_type, code, redirect_uri, client_id } = req.body;

    if (grant_type !== 'authorization_code') {
      return res.status(400).json({
        error: 'unsupported_grant_type'
      });
    }

    // Verificar auth code
    const authData = this.tempAuthCodes?.get(code);
    if (!authData || authData.expiresAt < Date.now()) {
      return res.status(400).json({
        error: 'invalid_grant'
      });
    }

    // Generar tokens
    const accessToken = crypto.randomBytes(32).toString('hex');
    const refreshToken = crypto.randomBytes(32).toString('hex');
    const idToken = this.generateMockIdToken(authData.user);

    // Limpiar auth code
    this.tempAuthCodes.delete(code);

    res.json({
      access_token: accessToken,
      token_type: 'Bearer',
      expires_in: 3600,
      refresh_token: refreshToken,
      scope: 'openid email profile',
      id_token: idToken
    });
  }

  /**
   * Endpoint mock de Google User Info
   */
  handleMockUserInfo(req, res) {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const accessToken = authHeader.substring(7);
    
    // En un caso real, verificaríamos el access token
    // Para el mock, retornamos información de usuario de prueba
    const mockUser = {
      id: 'google_mock_user_1',
      email: 'test.user@gmail.com',
      verified_email: true,
      name: 'Test User',
      given_name: 'Test',
      family_name: 'User',
      picture: 'https://via.placeholder.com/150/150/4285F4/FFFFFF?text=Test',
      locale: 'en'
    };

    res.json(mockUser);
  }

  /**
   * Obtener usuario de prueba por email
   */
  getMockUser(email) {
    return this.mockUsers.get(email);
  }

  /**
   * Obtener todos los usuarios de prueba
   */
  getAllMockUsers() {
    return Array.from(this.mockUsers.values());
  }

  /**
   * Crear nuevo usuario de prueba
   */
  createMockUser(userData) {
    const newUser = {
      id: `google_mock_user_${Date.now()}`,
      email: userData.email,
      name: userData.name || userData.email.split('@')[0],
      picture: userData.picture || `https://via.placeholder.com/150/150/4285F4/FFFFFF?text=${userData.name?.[0] || 'U'}`,
      password: userData.password || 'test123'
    };

    this.mockUsers.set(newUser.email, newUser);
    return newUser;
  }

  /**
   * Generar token de prueba directo (para testing automatizado)
   */
  generateTestToken(email = 'test.user@gmail.com') {
    const user = this.mockUsers.get(email);
    if (!user) {
      throw new Error(`Test user not found: ${email}`);
    }
    
    return this.generateMockIdToken(user);
  }
}

export const GoogleMockService = new GoogleMockService();

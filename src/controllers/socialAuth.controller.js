import { socialAuthService } from "../services/socialAuth.service.js";

export const SocialAuthController = {
  /**
   * Autenticar con Google Sign-In
   */
  async authenticateWithGoogle(req, res) {
    try {
      const { idToken } = req.body;

      if (!idToken) {
        return res.status(400).json({
          success: false,
          error: "Google ID token is required"
        });
      }

      const result = await SocialAuthService.authenticateWithGoogle(idToken);

      if (result.success) {
        res.json(result);
      } else {
        res.status(401).json(result);
      }

    } catch (error) {
      console.error("Google authentication error:", error);
      res.status(500).json({
        success: false,
        error: "Internal server error during Google authentication"
      });
    }
  },

  /**
   * Autenticar con Apple Sign-In
   */
  async authenticateWithApple(req, res) {
    try {
      const { identityToken, userInfo } = req.body;

      if (!identityToken) {
        return res.status(400).json({
          success: false,
          error: "Apple identity token is required"
        });
      }

      const result = await SocialAuthService.authenticateWithApple(identityToken, userInfo);

      if (result.success) {
        res.json(result);
      } else {
        res.status(401).json(result);
      }

    } catch (error) {
      console.error("Apple authentication error:", error);
      res.status(500).json({
        success: false,
        error: "Internal server error during Apple authentication"
      });
    }
  },

  /**
   * Refrescar token de pagos
   */
  async refreshPaymentToken(req, res) {
    try {
      const authHeader = req.headers.authorization;
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({
          success: false,
          error: "Authorization token is required"
        });
      }

      const currentToken = authHeader.substring(7);
      
      // Verificar token actual (aunque esté expirado)
      const decoded = jwt.decode(currentToken, { complete: true });
      if (!decoded) {
        return res.status(401).json({
          success: false,
          error: "Invalid token"
        });
      }

      // Generar nuevo token con la misma información
      const newToken = SocialAuthService.generatePaymentJWT({
        id: decoded.payload.sub,
        email: decoded.payload.email,
        name: decoded.payload.name,
        provider: decoded.payload.provider
      });

      res.json({
        success: true,
        paymentToken: newToken,
        expiresIn: process.env.JWT_EXPIRES_IN || '15m'
      });

    } catch (error) {
      console.error("Token refresh error:", error);
      res.status(500).json({
        success: false,
        error: "Internal server error during token refresh"
      });
    }
  },

  /**
   * Verificar token actual
   */
  async verifyToken(req, res) {
    try {
      const authHeader = req.headers.authorization;
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({
          success: false,
          error: "Authorization token is required"
        });
      }

      const token = authHeader.substring(7);
      const decoded = SocialAuthService.verifyPaymentJWT(token);

      res.json({
        success: true,
        user: {
          id: decoded.sub,
          email: decoded.email,
          name: decoded.name,
          provider: decoded.provider
        },
        expiresAt: new Date(decoded.exp * 1000)
      });

    } catch (error) {
      res.status(401).json({
        success: false,
        error: "Invalid or expired token"
      });
    }
  }
};

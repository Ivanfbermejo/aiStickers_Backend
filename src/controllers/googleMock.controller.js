import { googleMockService } from "../services/googleMock.service.js";

export const GoogleMockController = {
  /**
   * Página de login mock de Google
   */
  handleMockAuthPage(req, res) {
    try {
      googleMockService.handleMockAuthRequest(req, res);
    } catch (error) {
      console.error("Mock auth page error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  },

  /**
   * Manejar selección de usuario mock
   */
  handleMockUserSelection(req, res) {
    try {
      googleMockService.handleMockUserSelection(req, res);
    } catch (error) {
      console.error("Mock user selection error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  },

  /**
   * Endpoint mock de token exchange de Google
   */
  handleMockTokenExchange(req, res) {
    try {
      googleMockService.handleMockTokenExchange(req, res);
    } catch (error) {
      console.error("Mock token exchange error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  },

  /**
   * Endpoint mock de user info de Google
   */
  handleMockUserInfo(req, res) {
    try {
      googleMockService.handleMockUserInfo(req, res);
    } catch (error) {
      console.error("Mock user info error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  },

  /**
   * API para obtener token de prueba directamente
   */
  handleTestToken(req, res) {
    try {
      const { email } = req.query;
      const testToken = googleMockService.generateTestToken(email);
      
      res.json({
        success: true,
        testToken,
        expiresIn: '1h',
        userInfo: googleMockService.getMockUser(email || 'test.user@gmail.com')
      });
    } catch (error) {
      res.status(400).json({
        success: false,
        error: error.message
      });
    }
  },

  /**
   * API para listar usuarios de prueba
   */
  handleMockUsers(req, res) {
    try {
      const users = googleMockService.getAllMockUsers();
      
      res.json({
        success: true,
        users: users.map(user => ({
          id: user.id,
          email: user.email,
          name: user.name,
          picture: user.picture
        }))
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  },

  /**
   * API para crear nuevo usuario de prueba
   */
  handleCreateMockUser(req, res) {
    try {
      const { email, name, picture } = req.body;
      
      if (!email) {
        return res.status(400).json({
          success: false,
          error: "Email is required"
        });
      }

      const newUser = googleMockService.createMockUser({ email, name, picture });
      
      res.json({
        success: true,
        user: {
          id: newUser.id,
          email: newUser.email,
          name: newUser.name,
          picture: newUser.picture
        }
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }
};

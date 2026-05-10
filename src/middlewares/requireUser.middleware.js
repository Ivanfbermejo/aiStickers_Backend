import { AuthService } from "../services/auth.service.js";

/**
 * Middleware que exige un token de USUARIO (no App Token)
 * para operaciones que requieren identificación de usuario específico
 * (compras, balance, historial, etc.)
 */
export function requireUser(req, res, next) {
  const h = req.headers.authorization || "";
  const token = h.startsWith("Bearer ") ? h.slice(7) : null;
  
  if (!token) {
    return res.status(401).json({ error: "No token provided" });
  }
  
  try {
    const decoded = AuthService.verify(token);
    
    // Verificar que NO sea un App Token
    if (decoded.type === "app" || decoded.sub === "app") {
      return res.status(401).json({ 
        error: "User authentication required",
        message: "Please log in to perform this action"
      });
    }
    
    // Verificar que tenga un userId válido (email o id)
    if (!decoded.sub || decoded.sub === "" || decoded.sub === "null") {
      return res.status(401).json({ 
        error: "Invalid user token",
        message: "User identifier missing"
      });
    }
    
    req.user = decoded;
    return next();
  } catch (err) {
    return res.status(401).json({ error: "Invalid token" });
  }
}

import { AuthService } from "../services/auth.service.js";

export function auth(req, res, next) {
  const h = req.headers.authorization || "";
  const token = h.startsWith("Bearer ") ? h.slice(7) : null;
  if (!token) return res.status(401).json({ error: "No token" });
  try {
    req.user = AuthService.verify(token);
    return next();
  } catch {
    return res.status(401).json({ error: "Invalid token" });
  }
}

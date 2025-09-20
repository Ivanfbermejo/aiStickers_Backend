import express from "express";
import env from "./src/utils/env.js";
import { auth } from "./src/middlewares/auth.middleware.js";
import { AuthService } from "./src/services/auth.service.js";
import { AIController } from "./src/controllers/ai.controller.js";

const app = express();
app.use(express.json({ limit: "5mb" }));

// Emitir token (solo si X-App-Key coincide)
app.post("/auth/token", (req, res) => {
  const k = req.headers["x-app-key"];
  if (!k || k !== env.APP_KEY) return res.status(401).json({ error: "Unauthorized" });
  // payload mínimo; puedes meter un userId fijo si quieres
  const token = AuthService.sign({ sub: "ivan", scope: ["stickers"] });
  return res.json({ token, expiresIn: env.JWT_EXPIRES_IN || "1h" });
});

// Rutas protegidas
app.post("/upload-url", auth, AIController.uploadUrl);
app.post("/process",    auth, AIController.process);

export default app;

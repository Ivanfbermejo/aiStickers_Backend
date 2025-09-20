// index.js (fragmento relevante)
import express from "express";
import helmet from "helmet";
import cors from "cors";
import env from "./src/utils/env.js";
console.log("[SEC] CLIENT_ID =", JSON.stringify(env.CLIENT_ID));
import { AIController } from "./src/controllers/ai.controller.js";
import { AuthService } from "./src/services/auth.service.js";
import { auth } from "./src/middlewares/auth.middleware.js";
import { requireClientSignature } from "./src/middlewares/clientSign.middleware.js";

const app = express();
app.use(helmet());
app.use(cors());

// Captura rawBody para firmar/verificar exactamente el body
app.use(express.json({
  limit: "5mb",
  verify: (req, _res, buf) => { req.rawBody = Buffer.from(buf); }
}));

app.get("/health", (_req, res) => res.json({ ok: true }));

// Solo tu app (HMAC) puede pedir un JWT
app.post("/auth/token", requireClientSignature, (req, res) => {
  const token = AuthService.sign({ sub: "ivan", scope: ["stickers"] });
  res.json({ token, expiresIn: env.JWT_EXPIRES_IN });
});

// Endpoints protegidos por JWT
app.post("/upload-url", auth, AIController.uploadUrl);
app.post("/process",    auth, AIController.process);

const PORT = env.PORT || 3000;
app.listen(PORT, () => console.log(`API on :${PORT}`));

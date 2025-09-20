import jwt from "jsonwebtoken";
import env from "../utils/env.js";

export const AuthService = {
  sign(payload, opts = {}) {
    return jwt.sign(payload, env.JWT_SECRET, {
      expiresIn: env.JWT_EXPIRES_IN || "1h",
      ...opts,
    });
  },
  verify(token) {
    return jwt.verify(token, env.JWT_SECRET);
  },
};

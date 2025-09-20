import jwt from "jsonwebtoken";

export const AuthService = {
  sign(payload, opts = {}) {
    return jwt.sign(payload, process.env.JWT_SECRET, {
      expiresIn: process.env.JWT_EXPIRES_IN || "15m",
      ...opts,
    });
  },
  verify(token) {
    return jwt.verify(token, process.env.JWT_SECRET);
  },
};

import jwt from 'jsonwebtoken';

// Read directly from process.env instead of importing src/config/env.js.
// Importing the app's env module here would instantiate and cache it before
// buildTestApp() has a chance to set a per-test DATA_DIR, breaking test isolation.

/**
 * Build a valid user access token for integration tests.
 */
export function makeUserAccessToken(sub = 'user@example.com', options = {}) {
  return jwt.sign(
    {
      sub,
      type: 'user',
      scope: ['stickers'],
      ...options
    },
    process.env.JWT_SECRET,
    {
      algorithm: 'HS256',
      issuer: process.env.JWT_ISSUER,
      audience: process.env.JWT_AUDIENCE,
      expiresIn: '1h',
      jwtid: 'test-jti'
    }
  );
}

/**
 * Build an expired user access token for integration tests.
 */
export function makeExpiredUserAccessToken(sub = 'user@example.com') {
  return jwt.sign(
    {
      sub,
      type: 'user',
      scope: ['stickers']
    },
    process.env.JWT_SECRET,
    {
      algorithm: 'HS256',
      issuer: process.env.JWT_ISSUER,
      audience: process.env.JWT_AUDIENCE,
      expiresIn: -1,
      jwtid: 'expired-jti'
    }
  );
}

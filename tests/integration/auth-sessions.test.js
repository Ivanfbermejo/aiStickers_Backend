import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { createHash } from 'node:crypto';
import { buildTestApp } from '../helpers/app.js';
import { signRequest } from '../helpers/hmac.js';
import { makeExpiredUserAccessToken } from '../helpers/token.js';

const CLIENT_ID = process.env.CLIENT_ID;
const CLIENT_SECRET = process.env.CLIENT_SECRET;

function hmacFor(method, path, body) {
  return signRequest({ method, path, body, clientId: CLIENT_ID, clientSecret: CLIENT_SECRET });
}

describe('Auth sessions (T03)', () => {
  let ctx;

  beforeEach(async () => {
    ctx = await buildTestApp();
  });

  afterEach(() => {
    ctx.cleanup();
  });

  it('rejects an expired access token on private routes', async () => {
    const token = makeExpiredUserAccessToken();
    const headers = hmacFor('GET', '/api/v1/plans');

    const res = await request(ctx.app)
      .get('/api/v1/plans')
      .set(headers)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(401);
  });

  it('rejects a token signed with alg:none', async () => {
    const parts = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
    const payload = Buffer.from(JSON.stringify({
      sub: 'user@example.com',
      type: 'user',
      iss: process.env.JWT_ISSUER,
      aud: process.env.JWT_AUDIENCE,
      exp: Math.floor(Date.now() / 1000) + 3600
    })).toString('base64url');
    const token = `${parts}.${payload}.`;

    const headers = hmacFor('GET', '/api/v1/plans');
    const res = await request(ctx.app)
      .get('/api/v1/plans')
      .set(headers)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(401);
  });

  it('rejects a token with wrong issuer', async () => {
    const token = jwt.sign(
      { sub: 'user@example.com', type: 'user', scope: ['stickers'] },
      process.env.JWT_SECRET,
      { algorithm: 'HS256', issuer: 'wrong-issuer', audience: process.env.JWT_AUDIENCE, expiresIn: '1h' }
    );

    const headers = hmacFor('GET', '/api/v1/plans');
    const res = await request(ctx.app)
      .get('/api/v1/plans')
      .set(headers)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(401);
  });

  it('rejects a token with wrong audience', async () => {
    const token = jwt.sign(
      { sub: 'user@example.com', type: 'user', scope: ['stickers'] },
      process.env.JWT_SECRET,
      { algorithm: 'HS256', issuer: process.env.JWT_ISSUER, audience: 'wrong-audience', expiresIn: '1h' }
    );

    const headers = hmacFor('GET', '/api/v1/plans');
    const res = await request(ctx.app)
      .get('/api/v1/plans')
      .set(headers)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(401);
  });

  it('rejects an unconfigured test JWT', async () => {
    const token = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1c2VyIn0.not-a-real-signature';
    const headers = hmacFor('GET', '/api/v1/plans');

    const res = await request(ctx.app)
      .get('/api/v1/plans')
      .set(headers)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(401);
  });

  it('rotates refresh tokens and revokes reused ones (theft detection)', async () => {
    const session = await ctx.container.services.session.createSession({ userId: 'user@example.com' });

    const rotated = await ctx.container.services.session.rotateRefreshToken(session.refreshToken);
    expect(rotated.refreshToken).not.toBe(session.refreshToken);
    expect(rotated.accessToken).toBeTypeOf('string');

    // Reusing the old (already rotated) refresh token must revoke the whole family.
    await expect(
      ctx.container.services.session.rotateRefreshToken(session.refreshToken)
    ).rejects.toThrow('Refresh token reused');

    // The freshly rotated token should now be unusable too since the family was revoked.
    await expect(
      ctx.container.services.session.rotateRefreshToken(rotated.refreshToken)
    ).rejects.toThrow('Refresh token revoked');
  });

  it('rejects an unknown or garbage refresh token', async () => {
    await expect(
      ctx.container.services.session.rotateRefreshToken('not-a-real-refresh-token')
    ).rejects.toThrow('Invalid refresh token');
  });

  it('rejects an expired refresh token', async () => {
    const session = await ctx.container.services.session.createSession({ userId: 'user@example.com' });
    const stored = await ctx.container.repositories.session.findByRefreshTokenHash(
      createHash('sha256').update(session.refreshToken).digest('hex')
    );
    stored.expiresAt = new Date(Date.now() - 1000).toISOString();
    await ctx.container.repositories.session.update(stored);

    await expect(
      ctx.container.services.session.rotateRefreshToken(session.refreshToken)
    ).rejects.toThrow('Refresh token expired');
  });

  it('logout revokes the session so the refresh token can no longer be used', async () => {
    const session = await ctx.container.services.session.createSession({ userId: 'user@example.com' });
    const accessToken = jwt.sign(
      { sub: 'user@example.com', type: 'user', scope: ['stickers'] },
      process.env.JWT_SECRET,
      { algorithm: 'HS256', issuer: process.env.JWT_ISSUER, audience: process.env.JWT_AUDIENCE, expiresIn: '15m' }
    );

    const headers = hmacFor('POST', '/api/v1/auth/logout', { refreshToken: session.refreshToken });
    const res = await request(ctx.app)
      .post('/api/v1/auth/logout')
      .set(headers)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ refreshToken: session.refreshToken });

    expect(res.status).toBe(200);

    await expect(
      ctx.container.services.session.rotateRefreshToken(session.refreshToken)
    ).rejects.toThrow('Refresh token revoked');
  });

  it('rejects an app token on user-only routes', async () => {
    const appToken = ctx.container.services.jwt.generateAppToken();
    const headers = hmacFor('GET', '/api/v1/plans');

    const res = await request(ctx.app)
      .get('/api/v1/plans')
      .set(headers)
      .set('Authorization', `Bearer ${appToken}`);

    // /api/v1/plans only requires requireAuth (any valid token type), so the app token is accepted here.
    // Use a user-only route to confirm rejection.
    expect(res.status).toBe(200);

    const userOnlyHeaders = hmacFor('GET', '/api/v1/users/balance');
    const userOnlyRes = await request(ctx.app)
      .get('/api/v1/users/balance')
      .set(userOnlyHeaders)
      .set('Authorization', `Bearer ${appToken}`);

    expect(userOnlyRes.status).toBe(401);
  });

  it('refreshes via the HTTP endpoint end-to-end', async () => {
    const session = await ctx.container.services.session.createSession({ userId: 'user@example.com' });

    const headers = hmacFor('POST', '/api/v1/auth/refresh', { refreshToken: session.refreshToken });
    const res = await request(ctx.app)
      .post('/api/v1/auth/refresh')
      .set(headers)
      .send({ refreshToken: session.refreshToken });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.token).toBeTypeOf('string');
    expect(res.body.refreshToken).toBeTypeOf('string');
    expect(res.body.refreshToken).not.toBe(session.refreshToken);
  });
});

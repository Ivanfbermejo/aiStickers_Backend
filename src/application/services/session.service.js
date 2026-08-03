import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { env } from '../../config/env.js';
import { Session } from '../../domain/entities/session.entity.js';

function sha256Hex(value) {
  return createHash('sha256').update(value).digest('hex');
}

function addDays(date, days) {
  const result = new Date(date);
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

/**
 * Session Service
 * Manages refresh token lifecycle: create, rotate, revoke.
 * Refresh tokens are opaque, hashed in storage and belong to a family per session.
 */
export class SessionService {
  constructor({ sessionRepository, jwtService }) {
    this.sessionRepository = sessionRepository;
    this.jwtService = jwtService;
  }

  _generateOpaqueToken() {
    return randomBytes(32).toString('base64url');
  }

  _hashToken(token) {
    return sha256Hex(token);
  }

  /**
   * Create a new session for a user and return access/refresh tokens.
   * @param {Object} input
   * @param {string} input.userId
   * @param {Object} [input.metadata]
   */
  async createSession({ userId, metadata = {} }) {
    const refreshToken = this._generateOpaqueToken();
    const refreshTokenHash = this._hashToken(refreshToken);
    const family = randomUUID();

    const session = new Session({
      id: randomUUID(),
      userId,
      refreshTokenHash,
      family,
      expiresAt: addDays(new Date(), env.REFRESH_TOKEN_EXPIRES_IN_DAYS).toISOString(),
      metadata
    });

    await this.sessionRepository.save(session);

    const accessToken = this.jwtService.generateAccessToken({ sub: userId });

    return {
      accessToken,
      refreshToken,
      expiresIn: '15m'
    };
  }

  /**
   * Rotate a refresh token. The current one becomes unusable and a new one is issued.
   * If an old token is reused, the whole family is revoked (token theft detection).
   */
  async rotateRefreshToken(refreshToken) {
    const hash = this._hashToken(refreshToken);
    const session = await this.sessionRepository.findByRefreshTokenHash(hash);

    if (!session) {
      throw new Error('Invalid refresh token');
    }

    if (session.isRevoked()) {
      throw new Error('Refresh token revoked');
    }

    if (session.isExpired()) {
      throw new Error('Refresh token expired');
    }

    // If the token has already been rotated, this is a reuse attempt -> revoke family.
    if (session.rotatedTo) {
      await this.sessionRepository.revokeFamily(session.family);
      throw new Error('Refresh token reused');
    }

    const newRefreshToken = this._generateOpaqueToken();
    const newRefreshTokenHash = this._hashToken(newRefreshToken);
    const newFamily = session.family;

    const newSession = new Session({
      id: randomUUID(),
      userId: session.userId,
      refreshTokenHash: newRefreshTokenHash,
      family: newFamily,
      expiresAt: addDays(new Date(), env.REFRESH_TOKEN_EXPIRES_IN_DAYS).toISOString(),
      metadata: session.metadata
    });

    session.markRotatedTo(newSession.id);
    await this.sessionRepository.update(session);
    await this.sessionRepository.save(newSession);

    const accessToken = this.jwtService.generateAccessToken({ sub: session.userId });

    return {
      accessToken,
      refreshToken: newRefreshToken,
      expiresIn: '15m'
    };
  }

  /**
   * Revoke the session associated with a refresh token.
   */
  async revokeSession(refreshToken) {
    const hash = this._hashToken(refreshToken);
    const session = await this.sessionRepository.findByRefreshTokenHash(hash);

    if (!session || session.isRevoked() || session.isExpired()) {
      return;
    }

    session.revoke();
    await this.sessionRepository.update(session);
  }
}

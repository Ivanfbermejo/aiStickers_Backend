/**
 * Session Entity
 * Represents an authenticated session with a refresh token family.
 */
export class Session {
  constructor({
    id,
    userId,
    refreshTokenHash,
    family,
    createdAt,
    expiresAt,
    rotatedTo,
    revokedAt,
    metadata
  }) {
    this.id = id;
    this.userId = userId;
    this.refreshTokenHash = refreshTokenHash;
    this.family = family;
    this.createdAt = createdAt || new Date().toISOString();
    this.expiresAt = expiresAt;
    this.rotatedTo = rotatedTo || null;
    this.revokedAt = revokedAt || null;
    this.metadata = metadata || {};
  }

  isExpired() {
    return new Date(this.expiresAt) < new Date();
  }

  isRevoked() {
    return this.revokedAt !== null;
  }

  isUsable() {
    return !this.isRevoked() && !this.isExpired();
  }

  markRotatedTo(sessionId) {
    this.rotatedTo = sessionId;
  }

  revoke() {
    this.revokedAt = new Date().toISOString();
  }
}

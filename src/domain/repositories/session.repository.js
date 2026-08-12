/**
 * Session Repository Interface
 */
export class ISessionRepository {
  async findById(id) {
    throw new Error('Method not implemented');
  }

  async findByRefreshTokenHash(hash) {
    throw new Error('Method not implemented');
  }

  async findByFamily(family) {
    throw new Error('Method not implemented');
  }

  async save(session) {
    throw new Error('Method not implemented');
  }

  async update(session) {
    throw new Error('Method not implemented');
  }

  async revokeFamily(family) {
    throw new Error('Method not implemented');
  }

  /**
   * Atomically rotate a refresh token into a new descendant session.
   * Only succeeds if the token exists, is not revoked, is not expired and has
   * not been rotated before (rotatedTo is null).
   * @param {string} refreshTokenHash - SHA-256 of the current refresh token
   * @param {Object} candidate - Data for the new descendant session
   * @param {string} candidate.id
   * @param {string} candidate.refreshTokenHash
   * @param {Object} [candidate.metadata]
   * @returns {Promise<Session>} the created descendant session
   * @throws {Error} 'Invalid refresh token', 'Refresh token revoked',
   *                 'Refresh token expired', or 'Refresh token reused'
   */
  async rotate(refreshTokenHash, candidate) {
    throw new Error('Method not implemented');
  }
}

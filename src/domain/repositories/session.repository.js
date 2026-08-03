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
}

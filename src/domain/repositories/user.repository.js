/**
 * User Repository Interface
 * Defines contract for user data access
 */
export class IUserRepository {
  async findById(id) {
    throw new Error('Method not implemented');
  }
  
  async findByEmail(email) {
    throw new Error('Method not implemented');
  }
  
  async findByGoogleId(googleId) {
    throw new Error('Method not implemented');
  }
  
  async save(user) {
    throw new Error('Method not implemented');
  }
  
  async update(user) {
    throw new Error('Method not implemented');
  }
  
  async delete(id) {
    throw new Error('Method not implemented');
  }
  
  async exists(email) {
    throw new Error('Method not implemented');
  }
}

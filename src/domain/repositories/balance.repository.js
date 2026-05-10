/**
 * Balance Repository Interface
 * Defines contract for balance data access
 */
export class IBalanceRepository {
  async findByUserId(userId) {
    throw new Error('Method not implemented');
  }
  
  async save(balance) {
    throw new Error('Method not implemented');
  }
  
  async update(balance) {
    throw new Error('Method not implemented');
  }
  
  async createForUser(userId) {
    throw new Error('Method not implemented');
  }
  
  async exists(userId) {
    throw new Error('Method not implemented');
  }
}

/**
 * Transaction Repository Interface
 * Defines contract for transaction data access
 */
export class ITransactionRepository {
  async findById(id) {
    throw new Error('Method not implemented');
  }
  
  async findByUserId(userId, options = {}) {
    throw new Error('Method not implemented');
  }
  
  async findByProviderTransactionId(providerTransactionId) {
    throw new Error('Method not implemented');
  }
  
  async save(transaction) {
    throw new Error('Method not implemented');
  }
  
  async exists(providerTransactionId) {
    throw new Error('Method not implemented');
  }
  
  async getHistory(userId, limit = 50, offset = 0) {
    throw new Error('Method not implemented');
  }
}

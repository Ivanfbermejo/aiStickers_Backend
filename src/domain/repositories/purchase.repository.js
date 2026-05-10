/**
 * Purchase Repository Interface
 * Defines contract for purchase data access
 */
export class IPurchaseRepository {
  async findById(id) {
    throw new Error('Method not implemented');
  }
  
  async findByToken(purchaseToken) {
    throw new Error('Method not implemented');
  }
  
  async findByUserId(userId, status) {
    throw new Error('Method not implemented');
  }
  
  async save(purchase) {
    throw new Error('Method not implemented');
  }
  
  async update(purchase) {
    throw new Error('Method not implemented');
  }
  
  async exists(purchaseToken) {
    throw new Error('Method not implemented');
  }
}

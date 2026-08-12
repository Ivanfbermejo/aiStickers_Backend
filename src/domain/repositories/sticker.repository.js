/**
 * Sticker Repository Interface
 * Defines contract for sticker data access
 */
export class IStickerRepository {
  async findById(id, userId) {
    throw new Error('Method not implemented');
  }
  
  async findByUserId(userId) {
    throw new Error('Method not implemented');
  }
  
  async findByPackageId(packageId, userId) {
    throw new Error('Method not implemented');
  }
  
  async findByReplicateId(replicateId, userId) {
    throw new Error('Method not implemented');
  }
  
  async findByUserIdAndStatus(userId, status) {
    throw new Error('Method not implemented');
  }
  
  async save(sticker) {
    throw new Error('Method not implemented');
  }
  
  async update(sticker, userId = sticker?.userId) {
    throw new Error('Method not implemented');
  }
  
  async delete(id, userId) {
    throw new Error('Method not implemented');
  }
  
  async deleteByUserId(userId) {
    throw new Error('Method not implemented');
  }
  
  async countByUserId(userId) {
    throw new Error('Method not implemented');
  }
  
  async countByPackageId(packageId) {
    throw new Error('Method not implemented');
  }
}

/**
 * Package Repository Interface
 * Defines contract for package data access
 */
export class IPackageRepository {
  async findById(id) {
    throw new Error('Method not implemented');
  }
  
  async findByUserId(userId) {
    throw new Error('Method not implemented');
  }
  
  async findPublic() {
    throw new Error('Method not implemented');
  }
  
  async findByCategory(category) {
    throw new Error('Method not implemented');
  }
  
  async findByTag(tag) {
    throw new Error('Method not implemented');
  }
  
  async save(pkg) {
    throw new Error('Method not implemented');
  }
  
  async update(pkg) {
    throw new Error('Method not implemented');
  }
  
  async delete(id) {
    throw new Error('Method not implemented');
  }
  
  async deleteByUserId(userId) {
    throw new Error('Method not implemented');
  }
  
  async countByUserId(userId) {
    throw new Error('Method not implemented');
  }
  
  async exists(id) {
    throw new Error('Method not implemented');
  }
}

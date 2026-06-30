/**
 * GenerationJob Repository Interface
 * Defines contract for generation job data access
 */
export class IGenerationJobRepository {
  async save(job) {
    throw new Error('Method not implemented');
  }

  async update(job) {
    throw new Error('Method not implemented');
  }

  async findById(id) {
    throw new Error('Method not implemented');
  }

  async findByUserId(userId) {
    throw new Error('Method not implemented');
  }

  async findPending() {
    throw new Error('Method not implemented');
  }

  async findByStickerId(stickerId) {
    throw new Error('Method not implemented');
  }

  async delete(id) {
    throw new Error('Method not implemented');
  }

  async deleteByUserId(userId) {
    throw new Error('Method not implemented');
  }
}

export class ITelegramPackLinkRepository {
  async findByUserIdAndPackageId(userId, packageId) {
    throw new Error('Method not implemented');
  }

  async findBySetName(setName, userId) {
    throw new Error('Method not implemented');
  }

  async save(link) {
    throw new Error('Method not implemented');
  }

  async update(link, userId = link?.userId) {
    throw new Error('Method not implemented');
  }

  async deleteByPackageId(packageId, userId) {
    throw new Error('Method not implemented');
  }
}

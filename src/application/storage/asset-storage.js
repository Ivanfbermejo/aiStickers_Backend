/**
 * AssetStorage interface.
 *
 * Abstracts S3-compatible object storage and local file storage. Every object
 * is private by default and accessed through short-lived signed URLs or
 * authenticated streaming.
 */
export class AssetStorage {
  async putObject(key, buffer, metadata) {
    throw new Error('putObject is not implemented');
  }

  async getObject(key) {
    throw new Error('getObject is not implemented');
  }

  async getObjectMetadata(key) {
    throw new Error('getObjectMetadata is not implemented');
  }

  async objectExists(key) {
    throw new Error('objectExists is not implemented');
  }

  async deleteObject(key) {
    throw new Error('deleteObject is not implemented');
  }

  async listObjects(prefix) {
    throw new Error('listObjects is not implemented');
  }

  /**
   * Returns a short-lived signed URL that grants direct access to the object.
   * @param {string} key
   * @param {number} expiresInSeconds
   * @returns {Promise<string>}
   */
  async getSignedUrl(key, expiresInSeconds = 300) {
    throw new Error('getSignedUrl is not implemented');
  }
}

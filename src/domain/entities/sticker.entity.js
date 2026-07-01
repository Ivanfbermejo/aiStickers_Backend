/**
 * Sticker Entity - Core business object
 * Represents a generated sticker in the system
 */
export class Sticker {
  constructor({ 
    id, 
    userId, 
    packageId, 
    name, 
    imageUrl, 
    thumbnailUrl,
    webpUrl,
    animatedWebpUrl,
    whatsappWebpUrl,
    replicateId,
    status = 'pending',
    prompt,
    cost = 1,
    width,
    height,
    durationMs,
    sizeBytes,
    mimeType,
    exportStatus = 'pending', // pending, processing, ready, failed
    exportError,
    createdAt, 
    updatedAt 
  }) {
    this.id = id;
    this.userId = userId;
    this.packageId = packageId;
    this.name = name;
    this.imageUrl = imageUrl;
    this.thumbnailUrl = thumbnailUrl;
    this.webpUrl = webpUrl;
    this.animatedWebpUrl = animatedWebpUrl;
    this.whatsappWebpUrl = whatsappWebpUrl;
    this.replicateId = replicateId;
    this.status = status; // pending, processing, done, error
    this.prompt = prompt;
    this.cost = cost;
    this.width = width;
    this.height = height;
    this.durationMs = durationMs;
    this.sizeBytes = sizeBytes;
    this.mimeType = mimeType;
    this.exportStatus = exportStatus;
    this.exportError = exportError;
    this.createdAt = createdAt || new Date().toISOString();
    this.updatedAt = updatedAt || new Date().toISOString();
    
    this.validate();
  }
  
  validate() {
    if (!this.id) {
      throw new Error('Sticker ID is required');
    }
    if (!this.userId) {
      throw new Error('User ID is required');
    }
    if (!this.imageUrl && this.status === 'done') {
      throw new Error('Image URL is required for completed stickers');
    }
  }
  
  markAsProcessing() {
    this.status = 'processing';
    this.updatedAt = new Date().toISOString();
  }
  
  markAsDone(imageUrl, thumbnailUrl) {
    this.status = 'done';
    this.imageUrl = imageUrl;
    this.thumbnailUrl = thumbnailUrl;
    this.updatedAt = new Date().toISOString();
  }
  
  markAsError(errorMessage) {
    this.status = 'error';
    this.errorMessage = errorMessage;
    this.updatedAt = new Date().toISOString();
  }
  
  updateName(name) {
    this.name = name;
    this.updatedAt = new Date().toISOString();
  }
  
  moveToPackage(packageId) {
    this.packageId = packageId;
    this.updatedAt = new Date().toISOString();
  }
  
  isProcessing() {
    return this.status === 'processing';
  }
  
  isDone() {
    return this.status === 'done';
  }
  
  hasError() {
    return this.status === 'error';
  }
  
  markExportProcessing() {
    this.exportStatus = 'processing';
    this.exportError = null;
    this.updatedAt = new Date().toISOString();
  }
  
  markExportReady({ whatsappWebpUrl, width, height, durationMs, sizeBytes, mimeType }) {
    this.whatsappWebpUrl = whatsappWebpUrl;
    this.width = width;
    this.height = height;
    this.durationMs = durationMs;
    this.sizeBytes = sizeBytes;
    this.mimeType = mimeType;
    this.exportStatus = 'ready';
    this.exportError = null;
    this.updatedAt = new Date().toISOString();
  }
  
  markExportFailed(errorMessage) {
    this.exportStatus = 'failed';
    this.exportError = errorMessage;
    this.updatedAt = new Date().toISOString();
  }
  
  static createFromGeneration({ userId, packageId, name, replicateId, prompt, cost = 1 }) {
    return new Sticker({
      id: `sticker_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      userId,
      packageId,
      name: name || 'Generated Sticker',
      replicateId,
      prompt,
      cost,
      status: 'processing'
    });
  }
}

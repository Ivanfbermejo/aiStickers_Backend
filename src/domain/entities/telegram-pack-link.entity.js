/**
 * Persistent, local ownership record for a Telegram sticker set.
 */
const VALID_STATUSES = new Set(['pending', 'active', 'failed']);

export class TelegramPackLink {
  constructor({
    id,
    userId,
    telegramUserId,
    packageId,
    setName,
    stickerFileIds = {},
    stickerIdOrder = [],
    status = 'pending',
    createdAt,
    updatedAt
  }) {
    this.id = id;
    this.userId = userId;
    this.telegramUserId = String(telegramUserId);
    this.packageId = packageId;
    this.setName = setName;
    this.stickerFileIds = { ...stickerFileIds };
    this.stickerIdOrder = [...(stickerIdOrder || [])];
    this.status = status;
    this.createdAt = createdAt || new Date().toISOString();
    this.updatedAt = updatedAt || new Date().toISOString();
    this.validate();
  }

  validate() {
    if (!this.id) throw new Error('Telegram pack link ID is required');
    if (!this.userId) throw new Error('User ID is required');
    if (!this.telegramUserId || this.telegramUserId === 'undefined') {
      throw new Error('Telegram user ID is required');
    }
    if (!this.packageId) throw new Error('Package ID is required');
    if (!this.setName) throw new Error('Telegram set name is required');
    if (!this.stickerFileIds || typeof this.stickerFileIds !== 'object' || Array.isArray(this.stickerFileIds)) {
      throw new Error('Telegram sticker file IDs must be an object');
    }
    if (!Array.isArray(this.stickerIdOrder) || this.stickerIdOrder.some(id => typeof id !== 'string')) {
      throw new Error('Telegram sticker ID order must be an array of local sticker IDs');
    }
    if (!VALID_STATUSES.has(this.status)) {
      throw new Error('Telegram pack link status must be pending, active or failed');
    }
  }

  markActive() {
    this.status = 'active';
    this.updatedAt = new Date().toISOString();
  }

  markFailed() {
    this.status = 'failed';
    this.updatedAt = new Date().toISOString();
  }

  markPending() {
    this.status = 'pending';
    this.updatedAt = new Date().toISOString();
  }

  setStickerFileIds(stickerFileIds) {
    this.stickerFileIds = { ...stickerFileIds };
    this.updatedAt = new Date().toISOString();
  }

  /** Persist the local sticker order used for the next remote mutation. */
  setStickerIdOrder(stickerIdOrder) {
    this.stickerIdOrder = [...stickerIdOrder];
    this.updatedAt = new Date().toISOString();
  }

  static create({ userId, telegramUserId, packageId, setName, stickerFileIds = {}, stickerIdOrder = [] }) {
    return new TelegramPackLink({
      id: `telegram_link_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`,
      userId,
      telegramUserId,
      packageId,
      setName,
      stickerFileIds,
      stickerIdOrder
    });
  }
}

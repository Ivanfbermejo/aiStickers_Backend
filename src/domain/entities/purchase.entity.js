import { nanoid } from 'nanoid';

/**
 * Purchase Entity - Validated purchase from store
 */
export class Purchase {
  constructor({
    id,
    userId,
    productId,
    purchaseToken,
    provider, // 'GOOGLE_PLAY', 'APPLE_APP_STORE'
    status, // 'PENDING', 'VERIFIED', 'FAILED'
    stickerAmount,
    transactionId,
    fraudFlags = [],
    riskScore = 0,
    createdAt,
    verifiedAt
  }) {
    this.id = id;
    this.userId = userId;
    this.productId = productId;
    this.purchaseToken = purchaseToken;
    this.provider = provider;
    this.status = status || 'PENDING';
    this.stickerAmount = stickerAmount;
    this.transactionId = transactionId;
    this.fraudFlags = fraudFlags;
    this.riskScore = riskScore;
    this.createdAt = createdAt || new Date().toISOString();
    this.verifiedAt = verifiedAt;
  }
  
  verify(transactionId, fraudFlags = [], riskScore = 0) {
    this.status = 'VERIFIED';
    this.transactionId = transactionId;
    this.fraudFlags = fraudFlags;
    this.riskScore = riskScore;
    this.verifiedAt = new Date().toISOString();
  }
  
  markFailed() {
    this.status = 'FAILED';
  }
  
  isVerified() {
    return this.status === 'VERIFIED';
  }
  
  isPending() {
    return this.status === 'PENDING';
  }
  
  static create({ userId, productId, purchaseToken, provider, stickerAmount }) {
    return new Purchase({
      id: nanoid(),
      userId,
      productId,
      purchaseToken,
      provider,
      stickerAmount
    });
  }
  
  toJSON() {
    return {
      id: this.id,
      userId: this.userId,
      productId: this.productId,
      purchaseToken: this.purchaseToken,
      provider: this.provider,
      status: this.status,
      stickerAmount: this.stickerAmount,
      transactionId: this.transactionId,
      fraudFlags: this.fraudFlags,
      riskScore: this.riskScore,
      createdAt: this.createdAt,
      verifiedAt: this.verifiedAt
    };
  }
}

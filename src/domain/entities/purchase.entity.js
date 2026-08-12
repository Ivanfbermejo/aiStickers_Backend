import { randomId } from '../../utils/random-id.util.js';

/**
 * Purchase Entity - Validated purchase from store
 *
 * Lifecycle statuses:
 *   RECEIVED  -> locally accepted, not yet validated with the store
 *   PENDING   -> store validation in progress
 *   VERIFIED  -> store confirmed the purchase
 *   CREDITED  -> balance was credited in the same DB transaction
 *   REJECTED  -> store rejected or invalid
 *   REFUNDED  -> balance was refunded after a chargeback/revocation
 */
export class Purchase {
  constructor({
    id,
    userId,
    productId,
    purchaseToken,
    provider,
    status,
    stickerAmount,
    orderId,
    transactionId,
    fraudFlags = [],
    riskScore = 0,
    providerResponse,
    createdAt,
    verifiedAt,
    reconciledAt,
    reconcileAttempts = 0
  }) {
    this.id = id;
    this.userId = userId;
    this.productId = productId;
    this.purchaseToken = purchaseToken;
    this.provider = provider;
    this.status = status || 'RECEIVED';
    this.stickerAmount = stickerAmount;
    this.orderId = orderId ?? null;
    this.transactionId = transactionId ?? null;
    this.fraudFlags = fraudFlags;
    this.riskScore = riskScore;
    this.providerResponse = providerResponse ?? null;
    this.createdAt = createdAt || new Date().toISOString();
    this.verifiedAt = verifiedAt ?? null;
    this.reconciledAt = reconciledAt ?? null;
    this.reconcileAttempts = reconcileAttempts ?? 0;
  }

  markPending() {
    this.status = 'PENDING';
  }

  markRejected() {
    this.status = 'REJECTED';
    this.verifiedAt = new Date().toISOString();
  }

  verify(transactionId, fraudFlags = [], riskScore = 0, providerResponse) {
    this.status = 'VERIFIED';
    this.transactionId = transactionId;
    this.fraudFlags = fraudFlags;
    this.riskScore = riskScore;
    this.providerResponse = providerResponse ?? null;
    this.verifiedAt = new Date().toISOString();
  }

  credit(transactionId, fraudFlags = [], riskScore = 0, providerResponse) {
    this.status = 'CREDITED';
    this.transactionId = transactionId;
    this.fraudFlags = fraudFlags;
    this.riskScore = riskScore;
    this.providerResponse = providerResponse ?? null;
    this.verifiedAt = new Date().toISOString();
  }

  markRefunded() {
    this.status = 'REFUNDED';
  }

  isCredited() {
    return this.status === 'CREDITED';
  }

  isVerified() {
    return this.status === 'VERIFIED' || this.status === 'CREDITED';
  }

  isPending() {
    return this.status === 'PENDING' || this.status === 'RECEIVED';
  }

  static create({ userId, productId, purchaseToken, provider, stickerAmount, orderId }) {
    return new Purchase({
      id: randomId(),
      userId,
      productId,
      purchaseToken,
      provider,
      stickerAmount,
      orderId
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
      orderId: this.orderId,
      transactionId: this.transactionId,
      fraudFlags: this.fraudFlags,
      riskScore: this.riskScore,
      providerResponse: this.providerResponse,
      createdAt: this.createdAt,
      verifiedAt: this.verifiedAt,
      reconciledAt: this.reconciledAt,
      reconcileAttempts: this.reconcileAttempts
    };
  }
}

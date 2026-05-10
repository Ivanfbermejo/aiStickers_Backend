/**
 * Transaction Entity - Purchase or spending record
 */
export class Transaction {
  constructor({
    id,
    userId,
    type, // 'PURCHASE' or 'SPEND'
    amount,
    productId,
    provider, // 'GOOGLE_PLAY', 'APPLE_APP_STORE', 'SYSTEM'
    providerTransactionId,
    balanceAfter,
    metadata = {},
    createdAt
  }) {
    this.id = id;
    this.userId = userId;
    this.type = type;
    this.amount = amount;
    this.productId = productId;
    this.provider = provider;
    this.providerTransactionId = providerTransactionId;
    this.balanceAfter = balanceAfter;
    this.metadata = metadata;
    this.createdAt = createdAt || new Date().toISOString();
    
    this.validate();
  }
  
  validate() {
    if (!['PURCHASE', 'SPEND'].includes(this.type)) {
      throw new Error('Invalid transaction type');
    }
    if (this.amount <= 0) {
      throw new Error('Amount must be positive');
    }
    if (!this.userId) {
      throw new Error('User ID is required');
    }
  }
  
  isPurchase() {
    return this.type === 'PURCHASE';
  }
  
  isSpend() {
    return this.type === 'SPEND';
  }
  
  static createPurchase({ userId, amount, productId, provider, providerTransactionId, balanceAfter, metadata }) {
    return new Transaction({
      id: crypto.randomUUID(),
      userId,
      type: 'PURCHASE',
      amount,
      productId,
      provider,
      providerTransactionId,
      balanceAfter,
      metadata
    });
  }
  
  static createSpend({ userId, amount, productId, balanceAfter, metadata }) {
    return new Transaction({
      id: crypto.randomUUID(),
      userId,
      type: 'SPEND',
      amount,
      productId,
      provider: 'SYSTEM',
      balanceAfter,
      metadata
    });
  }
  
  toJSON() {
    return {
      id: this.id,
      userId: this.userId,
      type: this.type,
      amount: this.amount,
      productId: this.productId,
      provider: this.provider,
      providerTransactionId: this.providerTransactionId,
      balanceAfter: this.balanceAfter,
      metadata: this.metadata,
      createdAt: this.createdAt
    };
  }
}

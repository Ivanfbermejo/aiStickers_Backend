/**
 * Balance Entity - User's StickerDollars balance
 * Handles balance operations with business rules
 */
export class Balance {
  constructor({ userId, stickerDollars = 0, totalPurchased = 0, totalSpent = 0, createdAt, updatedAt }) {
    this.userId = userId;
    this.stickerDollars = stickerDollars;
    this.totalPurchased = totalPurchased;
    this.totalSpent = totalSpent;
    this.createdAt = createdAt || new Date().toISOString();
    this.updatedAt = updatedAt || new Date().toISOString();
  }
  
  /**
   * Add StickerDollars from purchase
   * @param {number} amount - Amount to add
   * @returns {number} New balance
   */
  add(amount) {
    if (amount <= 0) {
      throw new Error('Amount must be positive');
    }
    
    this.stickerDollars += amount;
    this.totalPurchased += amount;
    this.updatedAt = new Date().toISOString();
    
    return this.stickerDollars;
  }
  
  /**
   * Spend StickerDollars
   * @param {number} amount - Amount to spend
   * @returns {boolean} Success
   */
  spend(amount) {
    if (amount <= 0) {
      throw new Error('Amount must be positive');
    }
    
    if (this.stickerDollars < amount) {
      throw new Error('Insufficient balance');
    }
    
    this.stickerDollars -= amount;
    this.totalSpent += amount;
    this.updatedAt = new Date().toISOString();
    
    return true;
  }
  
  /**
   * Check if user has enough balance
   * @param {number} amount - Amount needed
   */
  hasEnough(amount) {
    return this.stickerDollars >= amount;
  }
  
  toJSON() {
    return {
      userId: this.userId,
      stickerDollars: this.stickerDollars,
      totalPurchased: this.totalPurchased,
      totalSpent: this.totalSpent,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt
    };
  }
}

/**
 * Plan Service
 * Maps product IDs to sticker amounts
 */
export class PlanService {
  constructor() {
    this.plans = new Map([
      ['com.animatedsticker.aistickers.coins_10', 10],
      ['com.animatedsticker.aistickers.basic_25', 25],
      ['com.animatedsticker.aistickers.plus_60', 60],
      ['com.animatedsticker.aistickers.pro_150', 150],
      ['com.animatedsticker.aistickers.vip_400', 400]
    ]);
  }
  
  /**
   * Get sticker count for product ID
   * @param {string} productId
   * @returns {number|null} Sticker count or null if invalid
   */
  getStickerCount(productId) {
    return this.plans.get(productId) || null;
  }
  
  /**
   * Get all available plans
   * @returns {Array} List of plans
   */
  getAllPlans() {
    return Array.from(this.plans.entries()).map(([productId, stickerCount]) => ({
      productId,
      stickerCount,
      name: this.getPlanName(stickerCount)
    }));
  }
  
  getPlanName(stickerCount) {
    const names = {
      10: 'Starter Pack',
      25: 'Basic Pack',
      60: 'Plus Pack',
      150: 'Pro Pack',
      400: 'VIP Pack'
    };
    return names[stickerCount] || 'Custom Pack';
  }
}

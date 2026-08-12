import { describe, it, expect } from 'vitest';
import { PlanService } from '../../src/application/services/plan.service.js';

describe('PlanService', () => {
  const service = new PlanService();

  it('maps known product IDs to sticker amounts', () => {
    expect(service.getStickerCount('com.animatedsticker.aistickers.coins_10')).toBe(10);
    expect(service.getStickerCount('com.animatedsticker.aistickers.vip_400')).toBe(400);
  });

  it('returns null for unknown product IDs', () => {
    expect(service.getStickerCount('unknown.product')).toBeNull();
  });

  it('returns all plans with names', () => {
    const plans = service.getAllPlans();
    expect(plans.length).toBeGreaterThan(0);
    const basic = plans.find(p => p.productId === 'com.animatedsticker.aistickers.basic_25');
    expect(basic.stickerCount).toBe(25);
    expect(basic.name).toBe('Basic Pack');
  });

  it('names custom amounts', () => {
    expect(service.getPlanName(999)).toBe('Custom Pack');
  });
});

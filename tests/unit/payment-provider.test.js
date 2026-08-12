import { describe, it, expect } from 'vitest';
import { PaymentProviderService } from '../../src/infrastructure/payment/payment-provider.service.js';
import { GooglePlayPaymentService } from '../../src/infrastructure/payment/google-play.service.js';

describe('PaymentProviderService', () => {
  it('rejects Apple App Store purchases while the feature flag is off', async () => {
    const service = new PaymentProviderService();
    const result = await service.validatePurchase({
      productId: 'com.animatedsticker.aistickers.coins_10',
      purchaseToken: 'fake-apple-receipt',
      provider: 'APPLE_APP_STORE'
    });

    expect(result.valid).toBe(false);
    expect(result.pending).toBe(false);
    expect(result.error).toMatch(/disabled|not implemented/i);
  });

  it('rejects unknown payment providers', async () => {
    const service = new PaymentProviderService();
    await expect(
      service.validatePurchase({
        productId: 'x',
        purchaseToken: 'x',
        provider: 'SOME_STORE'
      })
    ).rejects.toThrow('Unknown payment provider');
  });
});

describe('GooglePlayPaymentService', () => {
  it('returns pending when no Android Publisher client is available', async () => {
    const service = new GooglePlayPaymentService();
    const result = await service.validatePurchase({
      productId: 'com.animatedsticker.aistickers.coins_10',
      purchaseToken: 'token-xyz'
    });

    expect(result.valid).toBe(false);
    expect(result.pending).toBe(true);
    expect(result.error).toMatch(/pending|no Android Publisher client/i);
  });

  it('rejects invalid productIds', async () => {
    const service = new GooglePlayPaymentService();
    const result = await service.validatePurchase({
      productId: '',
      purchaseToken: 'token-xyz'
    });

    expect(result.valid).toBe(false);
    expect(result.pending).toBe(false);
    expect(result.error).toMatch(/productId/i);
  });

  it('rejects invalid purchaseTokens', async () => {
    const service = new GooglePlayPaymentService();
    const result = await service.validatePurchase({
      productId: 'com.animatedsticker.aistickers.coins_10',
      purchaseToken: ''
    });

    expect(result.valid).toBe(false);
    expect(result.pending).toBe(false);
    expect(result.error).toMatch(/purchaseToken/i);
  });

  it('uses an injected Android Publisher client for validation', async () => {
    const expectedPurchase = {
      purchaseState: 0,
      orderId: 'GPA.1234-5678-9012-34567'
    };
    const fakeClient = {
      purchases: {
        products: {
          get: async () => ({ data: expectedPurchase })
        }
      }
    };

    const service = new GooglePlayPaymentService({ androidPublisher: fakeClient });
    const result = await service.validatePurchase({
      productId: 'com.animatedsticker.aistickers.coins_10',
      purchaseToken: 'valid-token'
    });

    expect(result.valid).toBe(true);
    expect(result.orderId).toBe(expectedPurchase.orderId);
  });

  it('treats a non-purchased state as invalid without crediting', async () => {
    const fakeClient = {
      purchases: {
        products: {
          get: async () => ({ data: { purchaseState: 1, orderId: 'GPA.1234' } })
        }
      }
    };

    const service = new GooglePlayPaymentService({ androidPublisher: fakeClient });
    const result = await service.validatePurchase({
      productId: 'com.animatedsticker.aistickers.coins_10',
      purchaseToken: 'canceled-token'
    });

    expect(result.valid).toBe(false);
    expect(result.pending).toBe(false);
  });

  it('treats a pending state as pending without crediting', async () => {
    const fakeClient = {
      purchases: {
        products: {
          get: async () => ({ data: { purchaseState: 2, orderId: 'GPA.1234' } })
        }
      }
    };

    const service = new GooglePlayPaymentService({ androidPublisher: fakeClient });
    const result = await service.validatePurchase({
      productId: 'com.animatedsticker.aistickers.coins_10',
      purchaseToken: 'pending-token'
    });

    expect(result.valid).toBe(false);
    expect(result.pending).toBe(true);
  });

  it('rejects a Google Play response that lacks purchaseState', async () => {
    const fakeClient = {
      purchases: {
        products: {
          get: async () => ({ data: { orderId: 'GPA.1234' } })
        }
      }
    };

    const service = new GooglePlayPaymentService({ androidPublisher: fakeClient });
    const result = await service.validatePurchase({
      productId: 'com.animatedsticker.aistickers.coins_10',
      purchaseToken: 'bad-response-token'
    });

    expect(result.valid).toBe(false);
    expect(result.pending).toBe(false);
    expect(result.error).toMatch(/purchaseState/i);
  });

  it('rejects a Google Play response that lacks orderId', async () => {
    const fakeClient = {
      purchases: {
        products: {
          get: async () => ({ data: { purchaseState: 0 } })
        }
      }
    };

    const service = new GooglePlayPaymentService({ androidPublisher: fakeClient });
    const result = await service.validatePurchase({
      productId: 'com.animatedsticker.aistickers.coins_10',
      purchaseToken: 'no-order-token'
    });

    expect(result.valid).toBe(false);
    expect(result.pending).toBe(false);
    expect(result.error).toMatch(/orderId/i);
  });
});

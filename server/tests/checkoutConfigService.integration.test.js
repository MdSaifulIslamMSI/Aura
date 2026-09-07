const { resolveMarketContext } = require('../services/markets/marketCatalog');
const { getAvailablePaymentMethodsForMarket, getCheckoutConfig } = require('../services/checkoutConfigService');

describe('checkoutConfigService integration', () => {
  test('exposes policy, compliance and catalog rails beyond the basics', async () => {
    const market = resolveMarketContext({ country: 'IN', currency: 'INR', language: 'en' });
    const config = await getCheckoutConfig({ market, userId: null });
    expect(config.policy).toMatchObject({
      complianceFlags: expect.any(Array),
      featuredCategories: expect.any(Array),
      restrictedCategories: expect.any(Array),
    });
    expect(config.shippingOptions.length).toBeGreaterThan(0);
    expect(typeof config.capabilities).toBe('object');
  });

  test('threads authenticated users into provider resolution', async () => {
    const market = resolveMarketContext({ country: 'IN', currency: 'INR', language: 'en' });
    const guest = await getAvailablePaymentMethodsForMarket({ market, userId: null });
    const authed = await getAvailablePaymentMethodsForMarket({ market, userId: 'user-1' });
    expect(guest.methods).toContain('COD');
    expect(authed.methods).toContain('COD');
    expect(authed.capabilities).toBeDefined();
  });

  test('rejects unserviceable market contexts loudly', async () => {
    await expect(getCheckoutConfig({ market: null, userId: null })).rejects.toThrow();
  });
});

jest.mock('../services/payments/paymentCapabilities', () => ({ getPaymentCapabilities: jest.fn() }));
jest.mock('../services/payments/providerFactory', () => ({ getPaymentProvider: jest.fn() }));
jest.mock('../services/payments/paymentMarketCatalog', () => ({ resolvePaymentMarketContext: jest.fn() }));
jest.mock('../services/markets/marketCatalog', () => ({
  ensureMarketAccess: jest.fn((market) => market),
  getMarketRule: jest.fn(),
}));

const { getPaymentCapabilities } = require('../services/payments/paymentCapabilities');
const { getPaymentProvider } = require('../services/payments/providerFactory');
const { resolvePaymentMarketContext } = require('../services/payments/paymentMarketCatalog');
const { ensureMarketAccess, getMarketRule } = require('../services/markets/marketCatalog');
const {
  getAvailablePaymentMethodsForMarket,
  getCheckoutConfig,
} = require('../services/checkoutConfigService');

const market = { countryCode: 'IN', countryName: 'India', currency: 'INR', currencyName: 'Rupee', language: 'en', locale: 'en-IN', direction: 'ltr', source: 'test' };
const marketRule = {
  paymentMethods: ['COD', 'CARD', 'UPI'],
  addressSchema: { postalCode: true },
  taxRules: { gst: 18 },
  shippingOptions: [{ id: 'express', label: 'Express', etaLabel: '1-2 days' }],
  promotionLabel: 'Festive',
  complianceFlags: ['gst-invoice'],
  featuredCategories: ['Phones'],
  restrictedCategories: [],
};

describe('checkoutConfigService.getAvailablePaymentMethodsForMarket', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    getMarketRule.mockReturnValue(marketRule);
    getPaymentProvider.mockResolvedValue({ id: 'stripe' });
    getPaymentCapabilities.mockResolvedValue({ rails: { card: true } });
    resolvePaymentMarketContext.mockImplementation(() => ({}));
  });

  test('keeps COD without capability checks', async () => {
    const { methods } = await getAvailablePaymentMethodsForMarket({ market, userId: 'u-1' });
    expect(methods).toContain('COD');
    expect(resolvePaymentMarketContext).not.toHaveBeenCalledWith(expect.objectContaining({ paymentMethod: 'COD' }));
  });

  test('filters out methods the market context rejects', async () => {
    resolvePaymentMarketContext.mockImplementation(({ paymentMethod }) => {
      if (paymentMethod === 'CARD') throw new Error('unsupported');
      return {};
    });
    const { methods } = await getAvailablePaymentMethodsForMarket({ market });
    expect(methods).toEqual(expect.arrayContaining(['COD', 'UPI']));
    expect(methods).not.toContain('CARD');
  });

  test('tolerates provider resolution failures', async () => {
    getPaymentProvider.mockRejectedValue(new Error('no provider'));
    const { capabilities } = await getAvailablePaymentMethodsForMarket({ market });
    expect(getPaymentCapabilities).toHaveBeenCalledWith({ provider: null, allowFallback: true });
    expect(capabilities).toEqual({ rails: { card: true } });
  });

  test('resolves the provider for the market currency', async () => {
    await getAvailablePaymentMethodsForMarket({ market, userId: 'u-9' });
    expect(getPaymentProvider).toHaveBeenCalledWith({ currency: 'INR', paymentMethod: 'CARD', userId: 'u-9' });
    expect(ensureMarketAccess).toHaveBeenCalledWith(market);
  });
});

describe('checkoutConfigService.getCheckoutConfig', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    getMarketRule.mockReturnValue(marketRule);
    getPaymentProvider.mockResolvedValue({ id: 'stripe' });
    getPaymentCapabilities.mockResolvedValue({ rails: { card: true } });
    resolvePaymentMarketContext.mockImplementation(() => ({}));
  });

  test('assembles the full checkout runtime config', async () => {
    const config = await getCheckoutConfig({ market, userId: 'u-1' });
    expect(config.market).toMatchObject({ countryCode: 'IN', currency: 'INR' });
    expect(config.paymentMethods).toEqual(['COD', 'CARD', 'UPI']);
    expect(config.addressSchema).toEqual({ postalCode: true });
    expect(config.shippingOptions).toEqual(marketRule.shippingOptions);
    expect(config.policy).toMatchObject({ promotionLabel: 'Festive', complianceFlags: ['gst-invoice'] });
    expect(config.capabilities).toEqual({ card: true });
  });

  test('falls back to standard shipping when the market defines none', async () => {
    getMarketRule.mockReturnValue({ ...marketRule, shippingOptions: [] });
    const config = await getCheckoutConfig({ market });
    expect(config.shippingOptions).toEqual([
      { id: 'standard', label: 'Standard Delivery', etaLabel: '3-5 business days' },
    ]);
  });
});

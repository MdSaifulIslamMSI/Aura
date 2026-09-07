jest.mock('../services/markets/marketCatalog', () => ({
  DEFAULT_BASE_CURRENCY: 'INR',
  normalizeCurrencyCode: jest.fn((value) => String(value || '').trim().toUpperCase() || ''),
}));
jest.mock('../services/markets/marketFxService', () => ({
  DEFAULT_BROWSE_CURRENCIES: ['USD', 'EUR'],
  getBrowseFxPayload: jest.fn(),
}));

const { normalizeCurrencyCode } = require('../services/markets/marketCatalog');
const { getBrowseFxPayload } = require('../services/markets/marketFxService');
const { getBrowseFxRates } = require('../controllers/marketController');

const runHandler = (query = {}, market = {}) => {
  const req = { query, market };
  const res = { json: jest.fn() };
  const next = jest.fn();
  return { req, res, next };
};

describe('marketController.getBrowseFxRates', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    normalizeCurrencyCode.mockImplementation((value) => String(value || '').trim().toUpperCase() || '');
    getBrowseFxPayload.mockResolvedValue({ baseCurrency: 'INR', rates: { USD: 0.012 } });
  });

  test('prefers the explicit query base currency', async () => {
    const { req, res } = runHandler({ baseCurrency: 'inr', currencies: 'USD,EUR' }, { baseCurrency: 'USD' });
    await getBrowseFxRates(req, res, jest.fn());

    expect(getBrowseFxPayload).toHaveBeenCalledWith({ baseCurrency: 'INR', currencies: ['USD', 'EUR'] });
    expect(res.json).toHaveBeenCalledWith({ status: 'success', baseCurrency: 'INR', rates: { USD: 0.012 } });
  });

  test('falls back to the market base currency, then the default', async () => {
    const { req, res } = runHandler({}, { baseCurrency: 'EUR' });
    await getBrowseFxRates(req, res, jest.fn());
    expect(getBrowseFxPayload).toHaveBeenCalledWith(
      expect.objectContaining({ baseCurrency: 'EUR' })
    );

    const fallback = runHandler({}, {});
    await getBrowseFxRates(fallback.req, fallback.res, jest.fn());
    expect(getBrowseFxPayload).toHaveBeenLastCalledWith(
      expect.objectContaining({ baseCurrency: 'INR' })
    );
  });

  test('uses default browse currencies when none are requested', async () => {
    const { req, res } = runHandler({ baseCurrency: 'INR' }, {});
    await getBrowseFxRates(req, res, jest.fn());
    expect(getBrowseFxPayload).toHaveBeenCalledWith({ baseCurrency: 'INR', currencies: ['USD', 'EUR'] });
  });

  test('drops blank currency entries', async () => {
    const { req, res } = runHandler({ baseCurrency: 'INR', currencies: 'USD,,  ,' }, {});
    await getBrowseFxRates(req, res, jest.fn());
    expect(getBrowseFxPayload).toHaveBeenCalledWith({ baseCurrency: 'INR', currencies: ['USD'] });
  });
});

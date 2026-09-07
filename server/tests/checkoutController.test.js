const AppError = require('../utils/AppError');

jest.mock('../services/checkoutConfigService', () => ({
  getCheckoutConfig: jest.fn(),
}));

const { getCheckoutConfig } = require('../services/checkoutConfigService');
const { getCheckoutRuntimeConfig } = require('../controllers/checkoutController');

const runHandler = async ({ market = { countryCode: 'IN' }, user = { _id: 'user-1' } } = {}) => {
  const req = { market, user };
  const res = { json: jest.fn().mockReturnThis() };
  const next = jest.fn();
  await getCheckoutRuntimeConfig(req, res, next);
  return { req, res, next };
};

describe('checkoutController.getCheckoutRuntimeConfig', () => {
  beforeEach(() => jest.clearAllMocks());

  test('returns resolved checkout config', async () => {
    const config = { market: { countryCode: 'IN' }, paymentMethods: ['COD', 'CARD'] };
    getCheckoutConfig.mockResolvedValue(config);

    const { res, next } = await runHandler();

    expect(getCheckoutConfig).toHaveBeenCalledWith({
      market: { countryCode: 'IN' },
      userId: 'user-1',
    });
    expect(res.json).toHaveBeenCalledWith(config);
    expect(next).not.toHaveBeenCalled();
  });

  test('passes null userId for guest checkout', async () => {
    getCheckoutConfig.mockResolvedValue({ paymentMethods: ['COD'] });
    const req = { market: { countryCode: 'IN' }, user: null };
    const res = { json: jest.fn() };
    const next = jest.fn();

    await getCheckoutRuntimeConfig(req, res, next);

    expect(getCheckoutConfig).toHaveBeenCalledWith({
      market: { countryCode: 'IN' },
      userId: null,
    });
    expect(res.json).toHaveBeenCalled();
  });

  test('forwards AppError unchanged', async () => {
    const appError = new AppError('Market blocked', 403);
    getCheckoutConfig.mockRejectedValue(appError);

    const { next, res } = await runHandler();

    expect(next).toHaveBeenCalledWith(appError);
    expect(res.json).not.toHaveBeenCalled();
  });

  test('wraps unexpected errors as 500 AppError', async () => {
    getCheckoutConfig.mockRejectedValue(new Error('provider down'));

    const { next } = await runHandler();

    expect(next).toHaveBeenCalledTimes(1);
    const forwarded = next.mock.calls[0][0];
    expect(forwarded).toBeInstanceOf(AppError);
    expect(forwarded.statusCode).toBe(500);
    expect(forwarded.message).toBe('provider down');
  });

  test('wraps empty failures with fallback message', async () => {
    getCheckoutConfig.mockRejectedValue({});

    const { next } = await runHandler();

    const forwarded = next.mock.calls[0][0];
    expect(forwarded).toBeInstanceOf(AppError);
    expect(forwarded.message).toBe('Failed to resolve checkout config');
  });
});

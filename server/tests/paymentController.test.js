jest.mock('../services/payments/paymentService', () => ({
  listUserPaymentMethods: jest.fn(),
  listPaymentCapabilities: jest.fn(),
  listNetbankingBanks: jest.fn(),
  createPaymentMethodSetupIntent: jest.fn(),
  saveUserPaymentMethod: jest.fn(),
  deleteUserPaymentMethod: jest.fn(),
  setDefaultPaymentMethod: jest.fn(),
}));

const AppError = require('../utils/AppError');
const paymentService = require('../services/payments/paymentService');
const {
  addPaymentMethod,
  createMethodSetupIntent,
  removePaymentMethod,
  getNetbankingBanks,
  getPaymentCapabilitiesCatalog,
  getPaymentMethods,
  makeDefaultPaymentMethod,
} = require('../controllers/paymentController');

const mockReqRes = (overrides = {}) => {
  const req = { body: {}, params: {}, query: {}, headers: {}, user: { _id: 'user-1' }, ...overrides };
  const res = { json: jest.fn().mockReturnThis(), status: jest.fn().mockReturnThis() };
  const next = jest.fn();
  return { req, res, next };
};

describe('paymentController read catalogs', () => {
  beforeEach(() => jest.clearAllMocks());

  test('returns the caller payment methods', async () => {
    paymentService.listUserPaymentMethods.mockResolvedValue([{ id: 'pm-1' }]);
    const { req, res, next } = mockReqRes();
    await getPaymentMethods(req, res, next);
    expect(paymentService.listUserPaymentMethods).toHaveBeenCalledWith({ userId: 'user-1' });
    expect(res.json).toHaveBeenCalledWith([{ id: 'pm-1' }]);
    expect(next).not.toHaveBeenCalled();
  });

  test('returns capabilities and netbanking catalogs', async () => {
    paymentService.listPaymentCapabilities.mockResolvedValue({ card: true });
    paymentService.listNetbankingBanks.mockResolvedValue([{ code: 'HDFC' }]);

    const cap = mockReqRes();
    await getPaymentCapabilitiesCatalog(cap.req, cap.res, cap.next);
    expect(cap.res.json).toHaveBeenCalledWith({ card: true });

    const banks = mockReqRes();
    await getNetbankingBanks(banks.req, banks.res, banks.next);
    expect(banks.res.json).toHaveBeenCalledWith([{ code: 'HDFC' }]);
  });

  test('maps service failures to 500 with context', async () => {
    paymentService.listUserPaymentMethods.mockRejectedValue(new Error('db gone'));
    const { req, res, next } = mockReqRes();
    await getPaymentMethods(req, res, next);
    const forwarded = next.mock.calls[0][0];
    expect(forwarded).toBeInstanceOf(AppError);
    expect(forwarded.statusCode).toBe(500);
    expect(forwarded.message).toBe('db gone');
  });

  test('forwards AppErrors unchanged', async () => {
    const appError = new AppError('Forbidden', 403);
    paymentService.listNetbankingBanks.mockRejectedValue(appError);
    const { req, res, next } = mockReqRes();
    await getNetbankingBanks(req, res, next);
    expect(next).toHaveBeenCalledWith(appError);
  });
});

describe('paymentController method enrollment', () => {
  beforeEach(() => jest.clearAllMocks());

  test('starts setup intents with provider and type', async () => {
    paymentService.createPaymentMethodSetupIntent.mockResolvedValue({ clientSecret: 'cs_1' });
    const { req, res } = mockReqRes({ body: { provider: 'stripe', type: 'card' } });
    await createMethodSetupIntent(req, res, jest.fn());
    expect(paymentService.createPaymentMethodSetupIntent).toHaveBeenCalledWith({
      user: { _id: 'user-1' }, provider: 'stripe', type: 'card',
    });
    expect(res.status).toHaveBeenCalledWith(201);
  });

  test('saves tokenized methods with intent linkage', async () => {
    paymentService.saveUserPaymentMethod.mockResolvedValue({ id: 'pm-9' });
    const { req, res } = mockReqRes({ body: { token: 'tok', paymentIntentId: 'pi-1' } });
    await addPaymentMethod(req, res, jest.fn());
    expect(paymentService.saveUserPaymentMethod).toHaveBeenCalledWith({
      userId: 'user-1', method: req.body, paymentIntentId: 'pi-1',
    });
    expect(res.status).toHaveBeenCalledWith(201);
  });

  test('deletes and re-defaults methods by id', async () => {
    paymentService.deleteUserPaymentMethod.mockResolvedValue({});
    paymentService.setDefaultPaymentMethod.mockResolvedValue({ id: 'pm-2', isDefault: true });

    const del = mockReqRes({ params: { methodId: 'pm-1' } });
    await removePaymentMethod(del.req, del.res, del.next);
    expect(paymentService.deleteUserPaymentMethod).toHaveBeenCalledWith({ userId: 'user-1', methodId: 'pm-1' });

    const def = mockReqRes({ params: { methodId: 'pm-2' } });
    await makeDefaultPaymentMethod(def.req, def.res, def.next);
    expect(paymentService.setDefaultPaymentMethod).toHaveBeenCalledWith({ userId: 'user-1', methodId: 'pm-2' });
    expect(def.res.json).toHaveBeenCalledWith({ id: 'pm-2', isDefault: true });
  });
});

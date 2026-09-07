jest.mock('../models/PriceAlert', () => ({ find: jest.fn(), findOne: jest.fn(), create: jest.fn() }));
jest.mock('../models/Product', () => ({ find: jest.fn(), findOne: jest.fn() }));

const PriceAlert = require('../models/PriceAlert');
const Product = require('../models/Product');
const {
  createPriceAlert,
  deleteAlert,
  getMyAlerts,
  getPriceHistory,
} = require('../controllers/priceAlertController');

const mockReqRes = (overrides = {}) => {
  const req = { body: {}, params: {}, query: {}, user: { _id: 'user-1' }, ...overrides };
  const res = { json: jest.fn().mockReturnThis(), status: jest.fn().mockReturnThis() };
  const next = jest.fn();
  return { req, res, next };
};

const product = { id: 101, title: 'Phone', price: 50000, image: 'p.png', originalPrice: 55000 };

describe('priceAlertController.createPriceAlert', () => {
  beforeEach(() => jest.clearAllMocks());

  test('creates alerts below the current price', async () => {
    Product.findOne.mockReturnValue({ lean: jest.fn().mockResolvedValue(product) });
    PriceAlert.findOne.mockResolvedValue(null);
    PriceAlert.create.mockResolvedValue({ _id: 'a-1', targetPrice: 40000 });

    const { req, res, next } = mockReqRes({ body: { productId: 101, targetPrice: 40000 } });
    await createPriceAlert(req, res, next);

    expect(PriceAlert.create).toHaveBeenCalledWith(expect.objectContaining({
      user: 'user-1', productId: 101, productTitle: 'Phone', currentPrice: 50000, targetPrice: 40000,
    }));
    expect(res.status).toHaveBeenCalledWith(201);
    expect(next).not.toHaveBeenCalled();
  });

  test('rejects targets at or above the current price', async () => {
    Product.findOne.mockReturnValue({ lean: jest.fn().mockResolvedValue(product) });
    const { req, res, next } = mockReqRes({ body: { productId: 101, targetPrice: 50000 } });
    await createPriceAlert(req, res, next);
    expect(next.mock.calls[0][0].statusCode).toBe(400);
    expect(PriceAlert.create).not.toHaveBeenCalled();
  });

  test('returns 404 for unknown products', async () => {
    Product.findOne.mockReturnValue({ lean: jest.fn().mockResolvedValue(null) });
    const { req, res, next } = mockReqRes({ body: { productId: 999, targetPrice: 10 } });
    await createPriceAlert(req, res, next);
    expect(next.mock.calls[0][0].statusCode).toBe(404);
  });

  test('updates the existing active alert instead of duplicating', async () => {
    Product.findOne.mockReturnValue({ lean: jest.fn().mockResolvedValue(product) });
    const existing = { targetPrice: 45000, save: jest.fn().mockResolvedValue({}) };
    PriceAlert.findOne.mockResolvedValue(existing);

    const { req, res } = mockReqRes({ body: { productId: 101, targetPrice: 38000 } });
    await createPriceAlert(req, res, jest.fn());

    expect(existing.targetPrice).toBe(38000);
    expect(existing.currentPrice).toBe(50000);
    expect(existing.save).toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ updated: true }));
    expect(PriceAlert.create).not.toHaveBeenCalled();
  });
});

describe('priceAlertController.getMyAlerts', () => {
  beforeEach(() => jest.clearAllMocks());

  test('flags alerts whose price dropped to target', async () => {
    PriceAlert.find.mockReturnValue({
      sort: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue([{ _id: 'a-1', productId: 101, targetPrice: 40000, isActive: true }]),
      }),
    });
    Product.find.mockReturnValue({ lean: jest.fn().mockResolvedValue([{ id: 101, price: 39000 }]) });

    const { req, res } = mockReqRes();
    await getMyAlerts(req, res, jest.fn());
    const alerts = res.json.mock.calls[0][0].alerts;
    expect(alerts[0]).toMatchObject({ latestPrice: 39000, triggered: true });
  });

  test('leaves untriggered alerts alone above target', async () => {
    PriceAlert.find.mockReturnValue({
      sort: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue([{ _id: 'a-1', productId: 101, targetPrice: 40000, isActive: true }]),
      }),
    });
    Product.find.mockReturnValue({ lean: jest.fn().mockResolvedValue([{ id: 101, price: 50000 }]) });

    const { req, res } = mockReqRes();
    await getMyAlerts(req, res, jest.fn());
    expect(res.json.mock.calls[0][0].alerts[0].triggered).not.toBe(true);
  });

  test('skips the price lookup with no active alerts', async () => {
    PriceAlert.find.mockReturnValue({
      sort: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue([{ _id: 'a-9', isActive: false }]) }),
    });
    const { req, res } = mockReqRes();
    await getMyAlerts(req, res, jest.fn());
    expect(Product.find).not.toHaveBeenCalled();
  });
});

describe('priceAlertController.deleteAlert + getPriceHistory', () => {
  beforeEach(() => jest.clearAllMocks());

  test('deletes only caller-owned alerts', async () => {
    const deleteOne = jest.fn().mockResolvedValue({});
    PriceAlert.findOne.mockResolvedValue({ deleteOne });
    const { req, res, next } = mockReqRes({ params: { id: 'a-1' } });
    await deleteAlert(req, res, next);
    expect(PriceAlert.findOne).toHaveBeenCalledWith({ _id: 'a-1', user: 'user-1' });
    expect(deleteOne).toHaveBeenCalled();
  });

  test('returns 404 for foreign or missing alerts', async () => {
    PriceAlert.findOne.mockResolvedValue(null);
    const { req, res, next } = mockReqRes({ params: { id: 'a-x' } });
    await deleteAlert(req, res, next);
    expect(next.mock.calls[0][0].statusCode).toBe(404);
  });

  test('returns stored history when present', async () => {
    const history = [{ date: '2026-09-01', price: 48000 }];
    Product.findOne.mockReturnValue({ lean: jest.fn().mockResolvedValue({ ...product, priceHistory: history }) });
    const { req, res } = mockReqRes({ params: { productId: '101' } });
    await getPriceHistory(req, res, jest.fn());
    expect(res.json).toHaveBeenCalledWith({ success: true, history });
  });

  test('synthesizes a 31-point history when absent', async () => {
    Product.findOne.mockReturnValue({ lean: jest.fn().mockResolvedValue(product) });
    const { req, res } = mockReqRes({ params: { productId: '101' } });
    await getPriceHistory(req, res, jest.fn());
    const body = res.json.mock.calls[0][0];
    expect(body.synthetic).toBe(true);
    expect(body.history).toHaveLength(31);
  });

  test('returns empty history for unknown products', async () => {
    Product.findOne.mockReturnValue({ lean: jest.fn().mockResolvedValue(null) });
    const { req, res } = mockReqRes({ params: { productId: '404' } });
    await getPriceHistory(req, res, jest.fn());
    expect(res.json).toHaveBeenCalledWith({ success: true, history: [] });
  });
});

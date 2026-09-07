jest.mock('../models/TradeIn', () => ({ find: jest.fn(), findOne: jest.fn(), create: jest.fn() }));
jest.mock('../models/Product', () => ({ findOne: jest.fn() }));
jest.mock('../models/Listing', () => ({ findOne: jest.fn() }));

const TradeIn = require('../models/TradeIn');
const Product = require('../models/Product');
const Listing = require('../models/Listing');
const {
  cancelTradeIn,
  createTradeIn,
  estimateTradeIn,
  getMyTradeIns,
} = require('../controllers/tradeInController');

const OBJECT_ID = '507f1f77bcf86cd799439011';
const product = { id: 'p-target', title: 'Aura Phone', price: 50000, image: 'phone.png' };

const mockReqRes = (overrides = {}) => {
  const req = { body: {}, params: {}, user: { _id: 'user-1' }, ...overrides };
  const res = { json: jest.fn().mockReturnThis(), status: jest.fn().mockReturnThis() };
  const next = jest.fn();
  return { req, res, next };
};

describe('tradeInController.estimateTradeIn', () => {
  beforeEach(() => jest.clearAllMocks());

  test('values an owned listing by condition multiplier', async () => {
    Product.findOne.mockReturnValue({ lean: jest.fn().mockResolvedValue(product) });
    Listing.findOne.mockReturnValue({ lean: jest.fn().mockResolvedValue({ title: 'Old Phone', condition: 'good', price: 20000 }) });

    const { req, res, next } = mockReqRes({ body: { listingId: OBJECT_ID, targetProductId: 'p-target' } });
    await estimateTradeIn(req, res, next);

    expect(next).not.toHaveBeenCalled();
    const estimate = res.json.mock.calls[0][0].estimate;
    // good = 40% of 20000 = 8000, capped at 50% of 50000 = 25000.
    expect(estimate.estimatedValue).toBe(8000);
    expect(estimate.youPay).toBe(42000);
    expect(estimate.savings).toBe('16%');
  });

  test('rejects unowned or invalid listings with 404', async () => {
    Product.findOne.mockReturnValue({ lean: jest.fn().mockResolvedValue(product) });
    Listing.findOne.mockReturnValue({ lean: jest.fn().mockResolvedValue(null) });

    const { req, res, next } = mockReqRes({ body: { listingId: OBJECT_ID, targetProductId: 'p-target' } });
    await estimateTradeIn(req, res, next);

    expect(res.json).not.toHaveBeenCalled();
    expect(next.mock.calls[0][0].message).toBe('Listing not found');
  });

  test('requires either a listing or manual item details', async () => {
    Product.findOne.mockReturnValue({ lean: jest.fn().mockResolvedValue(product) });
    const { req, res, next } = mockReqRes({ body: { targetProductId: 'p-target' } });
    await estimateTradeIn(req, res, next);
    expect(next.mock.calls[0][0].message).toBe('Provide either a listing ID or manual item details');
    expect(next.mock.calls[0][0].statusCode).toBe(400);
  });

  test('returns 404 for unknown target products', async () => {
    Product.findOne.mockReturnValue({ lean: jest.fn().mockResolvedValue(null) });
    const { req, res, next } = mockReqRes({ body: { manualItem: { condition: 'fair' }, targetProductId: 'nope' } });
    await estimateTradeIn(req, res, next);
    expect(next.mock.calls[0][0].statusCode).toBe(404);
  });

  test('caps manual valuations at half the target price', async () => {
    Product.findOne.mockReturnValue({ lean: jest.fn().mockResolvedValue(product) });
    const { req, res, next } = mockReqRes({
      body: { manualItem: { condition: 'new', estimatedPrice: 100000 }, targetProductId: 'p-target' },
    });
    await estimateTradeIn(req, res, next);
    // new = 70% of 100000 = 70000 -> capped at 25000.
    expect(res.json.mock.calls[0][0].estimate.estimatedValue).toBe(25000);
  });
});

describe('tradeInController.createTradeIn', () => {
  beforeEach(() => jest.clearAllMocks());

  test('creates a pending trade-in for manual items', async () => {
    Product.findOne.mockReturnValue({ lean: jest.fn().mockResolvedValue(product) });
    TradeIn.findOne.mockResolvedValue(null);
    TradeIn.create.mockResolvedValue({ _id: 't-1', status: 'pending' });

    const { req, res, next } = mockReqRes({
      body: { manualItem: { condition: 'good', estimatedPrice: 10000 }, targetProductId: 'p-target' },
    });
    await createTradeIn(req, res, next);

    expect(TradeIn.create).toHaveBeenCalledWith(expect.objectContaining({ status: 'pending' }));
    expect(res.status).toHaveBeenCalledWith(201);
    expect(next).not.toHaveBeenCalled();
  });

  test('blocks duplicate pending trade-ins for the same product', async () => {
    Product.findOne.mockReturnValue({ lean: jest.fn().mockResolvedValue(product) });
    TradeIn.findOne.mockResolvedValue({ _id: 't-old', status: 'pending' });

    const { req, res, next } = mockReqRes({
      body: { manualItem: { condition: 'good' }, targetProductId: 'p-target' },
    });
    await createTradeIn(req, res, next);

    expect(TradeIn.create).not.toHaveBeenCalled();
    expect(next.mock.calls[0][0].message).toMatch(/already have a pending trade-in/);
  });
});

describe('tradeInController.getMyTradeIns + cancelTradeIn', () => {
  beforeEach(() => jest.clearAllMocks());

  test('lists the caller trade-ins newest first', async () => {
    const lean = jest.fn().mockResolvedValue([{ _id: 't-1' }]);
    TradeIn.find.mockReturnValue({ sort: jest.fn().mockReturnValue({ populate: jest.fn().mockReturnValue({ lean }) }) });

    const { req, res } = mockReqRes();
    await getMyTradeIns(req, res);

    expect(TradeIn.find).toHaveBeenCalledWith({ user: 'user-1' });
    expect(res.json).toHaveBeenCalledWith({ success: true, tradeIns: [{ _id: 't-1' }] });
  });

  test('cancels a pending trade-in', async () => {
    const deleteOne = jest.fn().mockResolvedValue({});
    TradeIn.findOne.mockResolvedValue({ status: 'pending', deleteOne });

    const { req, res, next } = mockReqRes({ params: { id: 't-1' } });
    await cancelTradeIn(req, res, next);

    expect(deleteOne).toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith({ success: true, message: 'Trade-in cancelled' });
  });

  test('refuses to cancel processed trade-ins', async () => {
    TradeIn.findOne.mockResolvedValue({ status: 'approved', deleteOne: jest.fn() });
    const { req, res, next } = mockReqRes({ params: { id: 't-1' } });
    await cancelTradeIn(req, res, next);
    expect(res.json).not.toHaveBeenCalled();
    expect(next.mock.calls[0][0].statusCode).toBe(400);
  });

  test('returns 404 when the trade-in does not belong to the caller', async () => {
    TradeIn.findOne.mockResolvedValue(null);
    const { req, res, next } = mockReqRes({ params: { id: 't-1' } });
    await cancelTradeIn(req, res, next);
    expect(next.mock.calls[0][0].statusCode).toBe(404);
  });
});

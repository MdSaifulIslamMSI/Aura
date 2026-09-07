const User = require('../models/User');
const Product = require('../models/Product');
const TradeIn = require('../models/TradeIn');
const { cancelTradeIn, createTradeIn } = require('../controllers/tradeInController');

const mockReqRes = (overrides = {}) => {
  const req = { body: {}, params: {}, user: { _id: 'user-1' }, ...overrides };
  const res = { json: jest.fn().mockReturnThis(), status: jest.fn().mockReturnThis() };
  const next = jest.fn();
  return { req, res, next };
};

describe('tradeInController integration', () => {
  let user;
  let product;

  beforeEach(async () => {
    user = await User.create({ name: 'Trader', email: `trader-${Date.now()}@example.com` });
    product = await Product.create({
      id: 424242, title: 'Aura Phone', brand: 'Aura', category: 'Phones',
      price: 50000, image: 'p.png', isPublished: true, stock: 3,
    });
  });

  test('creates and cancels a manual trade-in end to end', async () => {
    const create = mockReqRes({
      user: { _id: user._id },
      body: { manualItem: { condition: 'good', estimatedPrice: 20000 }, targetProductId: 424242 },
    });
    await createTradeIn(create.req, create.res, create.next);
    expect(create.next).not.toHaveBeenCalled();
    expect(create.res.status).toHaveBeenCalledWith(201);

    const stored = await TradeIn.findOne({ user: user._id });
    expect(stored.estimatedValue).toBeGreaterThan(0);

    const cancel = mockReqRes({ user: { _id: user._id }, params: { id: stored._id } });
    await cancelTradeIn(cancel.req, cancel.res, cancel.next);
    expect(cancel.res.json).toHaveBeenCalledWith({ success: true, message: 'Trade-in cancelled' });
    await expect(TradeIn.findById(stored._id)).resolves.toBeNull();
  });

  test('blocks duplicate pending trade-ins for the same target', async () => {
    const body = { manualItem: { condition: 'fair' }, targetProductId: 424242 };
    const first = mockReqRes({ user: { _id: user._id }, body });
    await createTradeIn(first.req, first.res, first.next);
    expect(first.next).not.toHaveBeenCalled();

    const second = mockReqRes({ user: { _id: user._id }, body });
    await createTradeIn(second.req, second.res, second.next);
    expect(second.next.mock.calls[0][0].message).toMatch(/pending trade-in/);
  });

  test('rejects trade-ins for unknown targets', async () => {
    const attempt = mockReqRes({
      user: { _id: user._id },
      body: { manualItem: { condition: 'good' }, targetProductId: 999999 },
    });
    await createTradeIn(attempt.req, attempt.res, attempt.next);
    expect(attempt.next.mock.calls[0][0].statusCode).toBe(404);
    await expect(TradeIn.countDocuments({ user: user._id })).resolves.toBe(0);
  });
});

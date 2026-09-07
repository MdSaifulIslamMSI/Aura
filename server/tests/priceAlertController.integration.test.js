const User = require('../models/User');
const Product = require('../models/Product');
const PriceAlert = require('../models/PriceAlert');
const {
  createPriceAlert,
  deleteAlert,
  getMyAlerts,
} = require('../controllers/priceAlertController');

const mockReqRes = (overrides = {}) => {
  const req = { body: {}, params: {}, user: { _id: 'user-1' }, ...overrides };
  const res = { json: jest.fn().mockReturnThis(), status: jest.fn().mockReturnThis() };
  const next = jest.fn();
  return { req, res, next };
};

describe('priceAlertController integration', () => {
  let user;

  beforeEach(async () => {
    user = await User.create({ name: 'Alert', email: `alert-${Date.now()}@example.com` });
    await Product.create({
      id: 777001, title: 'Alert Phone', brand: 'Aura', category: 'Phones',
      price: 50000, image: 'p.png', isPublished: true, stock: 4,
    });
  });

  test('creates alerts and triggers them on price drops', async () => {
    const create = mockReqRes({ user: { _id: user._id }, body: { productId: 777001, targetPrice: 45000 } });
    await createPriceAlert(create.req, create.res, create.next);
    expect(create.next).not.toHaveBeenCalled();
    expect(create.res.status).toHaveBeenCalledWith(201);

    await Product.updateOne({ id: 777001 }, { price: 44000 });
    const list = mockReqRes({ user: { _id: user._id } });
    await getMyAlerts(list.req, list.res, list.next);
    const alerts = list.res.json.mock.calls[0][0].alerts;
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({ latestPrice: 44000, triggered: true });
  });

  test('deletes caller alerts', async () => {
    const stored = await PriceAlert.create({
      user: user._id, productId: 777001, productTitle: 'Alert Phone',
      currentPrice: 50000, targetPrice: 45000,
    });
    const del = mockReqRes({ user: { _id: user._id }, params: { id: stored._id } });
    await deleteAlert(del.req, del.res, del.next);
    await expect(PriceAlert.findById(stored._id)).resolves.toBeNull();
  });
});

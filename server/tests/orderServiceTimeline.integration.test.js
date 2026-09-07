const mongoose = require('mongoose');
const User = require('../models/User');
const Product = require('../models/Product');
const Order = require('../models/Order');
const { getOrderTimelineData } = require('../services/orderService');

describe('orderService timeline integration', () => {
  let user;
  let product;
  let order;

  beforeEach(async () => {
    user = await User.create({ name: 'Buyer', email: `buyer-${Date.now()}@example.com` });
    product = await Product.create({
      id: 888001, title: 'Timeline Phone', brand: 'Aura', category: 'Phones',
      price: 30000, image: 'p.png', isPublished: true, stock: 2,
    });
    order = await Order.create({
      user: user._id,
      orderItems: [{ title: 'Timeline Phone', quantity: 1, image: 'p.png', price: 30000, product: product._id }],
      shippingAddress: { address: 'Street 1', city: 'Pune', postalCode: '411001', country: 'India' },
      paymentMethod: 'COD',
      itemsPrice: 30000,
    });
  });

  test('assembles the owner timeline with empty relations', async () => {
    const timeline = await getOrderTimelineData(order._id, user._id);
    expect(timeline.order._id.toString()).toBe(order._id.toString());
    expect(timeline.paymentIntent).toBeNull();
    expect(timeline.paymentEvents).toEqual([]);
  });

  test('enforces owner-only access across tenants', async () => {
    const stranger = new mongoose.Types.ObjectId();
    await expect(getOrderTimelineData(order._id, stranger)).rejects.toMatchObject({ statusCode: 404 });
  });
});

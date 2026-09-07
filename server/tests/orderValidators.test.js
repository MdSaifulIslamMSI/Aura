const {
  adminCancelOrderSchema,
  adminOrderStatusSchema,
  buyAgainSchema,
  cancelOrderSchema,
  commandCenterParamsSchema,
  commandCenterRefundSchema,
  createOrderSchema,
  getMyOrdersSchema,
  getOrderTimelineSchema,
  quoteOrderSchema,
} = require('../validators/orderValidators');

const validAddress = {
  address: '221B Baker Street', city: 'London', postalCode: '10001', country: 'India',
};
const validItem = { productId: 10, quantity: 2 };

describe('orderValidators checkout schemas', () => {
  test('quote accepts legacy and modern payloads', () => {
    expect(() => quoteOrderSchema.parse({
      body: { orderItems: [{ product: 10, qty: 2 }], shippingAddress: { ...validAddress, street: 'X', pincode: '1', state: 'Y' }, paymentMethod: 'COD' },
    })).not.toThrow();
    expect(() => quoteOrderSchema.parse({
      body: { orderItems: [validItem], shippingAddress: validAddress, paymentMethod: 'UPI' },
    })).not.toThrow();
  });

  test('rejects items without identity or quantity', () => {
    expect(quoteOrderSchema.safeParse({
      body: { orderItems: [{ quantity: 1 }], shippingAddress: validAddress },
    }).success).toBe(false);
    expect(quoteOrderSchema.safeParse({
      body: { orderItems: [{ productId: 1 }], shippingAddress: validAddress },
    }).success).toBe(false);
  });

  test('requires address, postal code and country equivalents', () => {
    expect(quoteOrderSchema.safeParse({
      body: { orderItems: [validItem], shippingAddress: { city: 'Pune' } },
    }).success).toBe(false);
  });

  test('directBuy requires at least one item', () => {
    expect(quoteOrderSchema.safeParse({
      body: { shippingAddress: validAddress, checkoutSource: 'directBuy' },
    }).success).toBe(false);
    expect(() => quoteOrderSchema.parse({
      body: { orderItems: [validItem], shippingAddress: validAddress, checkoutSource: 'directBuy' },
    })).not.toThrow();
  });

  test('rejects unknown payment methods and bad delivery slots', () => {
    expect(quoteOrderSchema.safeParse({
      body: { orderItems: [validItem], shippingAddress: validAddress, paymentMethod: 'BARTER' },
    }).success).toBe(false);
    expect(quoteOrderSchema.safeParse({
      body: { orderItems: [validItem], shippingAddress: validAddress, deliverySlot: { date: 'tomorrow', window: '' } },
    }).success).toBe(false);
  });

  test('create mirrors quote validation', () => {
    expect(() => createOrderSchema.parse({
      body: { orderItems: [validItem], shippingAddress: validAddress },
    })).not.toThrow();
  });
});

describe('orderValidators read and command schemas', () => {
  test('timeline and listing queries validate ids and pagination', () => {
    expect(() => getOrderTimelineSchema.parse({ params: { id: '507f1f77bcf86cd799439011' } })).not.toThrow();
    expect(() => getMyOrdersSchema.parse({ query: {} })).not.toThrow();
    expect(getMyOrdersSchema.safeParse({ query: { page: '-3' } }).success).toBe(false);
  });

  test('command-center params scope actions to an order', () => {
    expect(() => commandCenterParamsSchema.parse({ params: { id: '507f1f77bcf86cd799439011' } })).not.toThrow();
    expect(commandCenterParamsSchema.safeParse({ params: {} }).success).toBe(false);
  });

  test('refund commands require positive amounts', () => {
    expect(() => commandCenterRefundSchema.parse({
      params: { id: '507f1f77bcf86cd799439011' },
      body: { amount: 500, reason: 'Defective item received' },
    })).not.toThrow();
    expect(commandCenterRefundSchema.safeParse({
      params: { id: '507f1f77bcf86cd799439011' },
      body: { amount: -5, reason: 'Defective item received' },
    }).success).toBe(false);
  });

  test('cancel and buy-again validate order references', () => {
    expect(() => cancelOrderSchema.parse({ params: { id: '507f1f77bcf86cd799439011' }, body: { reason: 'Changed my mind' } })).not.toThrow();
    expect(() => buyAgainSchema.parse({ params: { id: '507f1f77bcf86cd799439011' } })).not.toThrow();
  });

  test('admin status transitions stay within the state machine', () => {
    expect(() => adminOrderStatusSchema.parse({ params: { id: '507f1f77bcf86cd799439011' }, body: { status: 'shipped' } })).not.toThrow();
    expect(adminOrderStatusSchema.safeParse({ params: { id: '507f1f77bcf86cd799439011' }, body: { status: 'teleported' } }).success).toBe(false);
    expect(() => adminCancelOrderSchema.parse({ params: { id: '507f1f77bcf86cd799439011' }, body: { reason: 'Fraud confirmed by risk team' } })).not.toThrow();
  });
});

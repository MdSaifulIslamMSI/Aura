const {
  adminOrderEmailDetailSchema,
  adminOrderEmailListSchema,
  adminOrderEmailRetrySchema,
} = require('../validators/orderEmailValidators');

describe('orderEmailValidators', () => {
  test('lists bound statuses and pagination', () => {
    expect(() => adminOrderEmailListSchema.parse({ query: { status: 'retry', page: '2' } })).not.toThrow();
    expect(adminOrderEmailListSchema.safeParse({ query: { status: 'vaporized' } }).success).toBe(false);
    expect(adminOrderEmailListSchema.safeParse({ query: { limit: '999' } }).success).toBe(false);
  });

  test('detail and retry enforce notification id lengths', () => {
    expect(() => adminOrderEmailDetailSchema.parse({ params: { notificationId: 'notif-123456' } })).not.toThrow();
    expect(adminOrderEmailDetailSchema.safeParse({ params: { notificationId: 'short' } }).success).toBe(false);
    expect(() => adminOrderEmailRetrySchema.parse({ params: { notificationId: 'notif-123456' } })).not.toThrow();
    expect(adminOrderEmailRetrySchema.safeParse({ params: { notificationId: 'x'.repeat(200) } }).success).toBe(false);
  });
});

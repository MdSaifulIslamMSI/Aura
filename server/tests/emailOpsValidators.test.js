const {
  adminEmailOpsDeliveryListSchema,
  adminEmailOpsQueueDetailSchema,
  adminEmailOpsQueueListSchema,
  adminEmailOpsQueueRetrySchema,
  adminEmailOpsSummarySchema,
  adminEmailOpsTestSendSchema,
} = require('../validators/emailOpsValidators');

describe('emailOpsValidators delivery and queue', () => {
  test('delivery lists bound statuses and providers', () => {
    expect(() => adminEmailOpsDeliveryListSchema.parse({ query: { status: 'failed', provider: 'resend' }, params: {} })).not.toThrow();
    expect(adminEmailOpsDeliveryListSchema.safeParse({ query: { status: 'lost' }, params: {} }).success).toBe(false);
    expect(adminEmailOpsDeliveryListSchema.safeParse({ query: { provider: 'pigeon' }, params: {} }).success).toBe(false);
  });

  test('queue lists scope to lifecycle states', () => {
    expect(() => adminEmailOpsQueueListSchema.parse({ query: { status: 'retry', orderId: 'o-1' }, params: {} })).not.toThrow();
    expect(adminEmailOpsQueueListSchema.safeParse({ query: { status: 'unknown' }, params: {} }).success).toBe(false);
  });

  test('queue detail and retry validate notification ids', () => {
    expect(() => adminEmailOpsQueueDetailSchema.parse({ query: {}, params: { notificationId: 'notif-123' }, body: {} })).not.toThrow();
    expect(adminEmailOpsQueueDetailSchema.safeParse({ query: {}, params: { notificationId: 'x' }, body: {} }).success).toBe(false);
    expect(() => adminEmailOpsQueueRetrySchema.parse({ query: {}, params: { notificationId: 'notif-123' } })).not.toThrow();
  });

  test('summary accepts open queries', () => {
    expect(() => adminEmailOpsSummarySchema.parse({ query: { range: '7d' }, params: {} })).not.toThrow();
  });

  test('test sends validate recipient emails', () => {
    expect(() => adminEmailOpsTestSendSchema.parse({ query: {}, params: {}, body: { recipientEmail: 'a@example.com' } })).not.toThrow();
    expect(adminEmailOpsTestSendSchema.safeParse({ query: {}, params: {}, body: { recipientEmail: 'nope' } }).success).toBe(false);
  });
});

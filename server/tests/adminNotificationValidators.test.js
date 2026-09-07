const {
  adminNotificationListSchema,
  adminNotificationMarkAllReadSchema,
  adminNotificationMarkReadSchema,
} = require('../validators/adminNotificationValidators');

describe('adminNotificationValidators listing', () => {
  test('accepts filters with severities and flags', () => {
    expect(() => adminNotificationListSchema.parse({
      query: { severity: 'critical', unreadOnly: true, page: '1' },
    })).not.toThrow();
  });

  test('rejects unknown severities', () => {
    expect(adminNotificationListSchema.safeParse({ query: { severity: 'apocalyptic' } }).success).toBe(false);
  });
});

describe('adminNotificationValidators read state', () => {
  test('single reads validate notification ids', () => {
    expect(() => adminNotificationMarkReadSchema.parse({
      params: { notificationId: 'notif-123456' }, body: { read: true },
    })).not.toThrow();
    expect(adminNotificationMarkReadSchema.safeParse({
      params: { notificationId: 'x' },
    }).success).toBe(false);
  });

  test('bulk reads accept empty filters', () => {
    expect(() => adminNotificationMarkAllReadSchema.parse({ body: {} })).not.toThrow();
    expect(() => adminNotificationMarkAllReadSchema.parse({})).not.toThrow();
  });
});

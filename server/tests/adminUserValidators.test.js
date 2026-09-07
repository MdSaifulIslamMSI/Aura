const {
  adminDeleteUserSchema,
  adminDismissWarningSchema,
  adminReactivateUserSchema,
  adminSuspendUserSchema,
  adminUserDetailSchema,
  adminUserListSchema,
  adminWarnUserSchema,
} = require('../validators/adminUserValidators');

describe('adminUserValidators listing and detail', () => {
  test('listings filter by account state with pagination', () => {
    expect(() => adminUserListSchema.parse({ query: { accountState: 'suspended', page: '2' } })).not.toThrow();
    expect(adminUserListSchema.safeParse({ query: { accountState: 'banned' } }).success).toBe(false);
  });

  test('detail scopes to user ids', () => {
    expect(() => adminUserDetailSchema.parse({ params: { userId: 'user-12345' } })).not.toThrow();
    expect(adminUserDetailSchema.safeParse({ params: { userId: 'x' } }).success).toBe(false);
  });
});

describe('adminUserValidators moderation lifecycle', () => {
  test('suspend requires reasons with bounded durations', () => {
    expect(() => adminSuspendUserSchema.parse({
      params: { userId: 'user-12345' }, body: { reason: 'Payment fraud confirmed', durationHours: 48 },
    })).not.toThrow();
    expect(adminSuspendUserSchema.safeParse({
      params: { userId: 'user-12345' }, body: { reason: 'x', durationHours: 48 },
    }).success).toBe(false);
    expect(adminSuspendUserSchema.safeParse({
      params: { userId: 'x' }, body: { reason: 'Payment fraud confirmed' },
    }).success).toBe(false);
  });

  test('warn requires reasons; dismiss and reactivate accept empty bodies', () => {
    expect(() => adminWarnUserSchema.parse({
      params: { userId: 'user-12345' }, body: { reason: 'First warning issued' },
    })).not.toThrow();
    expect(() => adminDismissWarningSchema.parse({ params: { userId: 'user-12345' }, body: {} })).not.toThrow();
    expect(() => adminReactivateUserSchema.parse({ params: { userId: 'user-12345' }, body: {} })).not.toThrow();
  });

  test('delete requires an audit reason with optional PII scrubbing', () => {
    expect(() => adminDeleteUserSchema.parse({
      params: { userId: 'user-12345' }, body: { reason: 'GDPR erasure request', scrubPII: true },
    })).not.toThrow();
    expect(adminDeleteUserSchema.safeParse({
      params: { userId: 'user-12345' }, body: {},
    }).success).toBe(false);
  });
});

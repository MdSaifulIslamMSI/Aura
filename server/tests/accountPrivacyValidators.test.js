const {
  privacyRequestIdSchema,
  requestDeactivationSchema,
  requestDeletionSchema,
  requestExportSchema,
} = require('../validators/accountPrivacyValidators');

const OBJECT_ID = '507f1f77bcf86cd799439011';

describe('accountPrivacyValidators requests', () => {
  test('export requests default to the account scope', () => {
    const parsed = requestExportSchema.parse({ body: {} });
    expect(parsed.body.scope).toBe('account');
  });

  test('deactivation requires the exact confirmation phrase', () => {
    expect(() => requestDeactivationSchema.parse({ body: { confirmation: 'DEACTIVATE' } })).not.toThrow();
    expect(requestDeactivationSchema.safeParse({ body: { confirmation: 'deactivate' } }).success).toBe(false);
    expect(requestDeactivationSchema.safeParse({ body: {} }).success).toBe(false);
  });

  test('deletion requires its own explicit phrase', () => {
    expect(() => requestDeletionSchema.parse({ body: { confirmation: 'DELETE MY ACCOUNT' } })).not.toThrow();
    expect(requestDeletionSchema.safeParse({ body: { confirmation: 'DEACTIVATE' } }).success).toBe(false);
  });

  test('request lookups validate ObjectIds', () => {
    expect(() => privacyRequestIdSchema.parse({ params: { requestId: OBJECT_ID } })).not.toThrow();
    expect(privacyRequestIdSchema.safeParse({ params: { requestId: 'bad' } }).success).toBe(false);
  });

  test('rejects authority smuggling in destructive bodies', () => {
    expect(requestDeletionSchema.safeParse({
      body: { confirmation: 'DELETE MY ACCOUNT', userId: 'other-user' },
    }).success).toBe(false);
  });
});

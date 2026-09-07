const {
  getAccountSecurityActivitySchema,
  getAccountSessionsSchema,
  revokeAccountSessionSchema,
  revokeAllAccountSessionsSchema,
  revokeOtherAccountSessionsSchema,
} = require('../validators/accountSessionValidators');

const ALIAS = 'a'.repeat(43);

describe('accountSessionValidators reads', () => {
  test('session listing bounds page sizes', () => {
    expect(() => getAccountSessionsSchema.parse({})).not.toThrow();
    expect(() => getAccountSessionsSchema.parse({ query: { limit: '10' } })).not.toThrow();
    expect(getAccountSessionsSchema.safeParse({ query: { limit: '99' } }).success).toBe(false);
  });

  test('security activity supports cursor pagination', () => {
    expect(() => getAccountSecurityActivitySchema.parse({ query: { cursor: 'cur-1', limit: '50' } })).not.toThrow();
    expect(getAccountSecurityActivitySchema.safeParse({ query: { limit: '500' } }).success).toBe(false);
  });
});

describe('accountSessionValidators revocation', () => {
  test('single revocation requires opaque 43-char aliases', () => {
    expect(() => revokeAccountSessionSchema.parse({ params: { sessionAlias: ALIAS } })).not.toThrow();
    expect(revokeAccountSessionSchema.safeParse({ params: { sessionAlias: 'short' } }).success).toBe(false);
  });

  test('revocation bodies stay empty (no authority smuggling)', () => {
    expect(revokeAccountSessionSchema.safeParse({
      params: { sessionAlias: ALIAS }, body: { userId: 'another-user' },
    }).success).toBe(false);
    expect(revokeOtherAccountSessionsSchema.safeParse({
      body: { preserveSessionId: 'client-chosen-session' },
    }).success).toBe(false);
    expect(revokeAllAccountSessionsSchema.safeParse({
      body: { userId: 'another-user' },
    }).success).toBe(false);
  });

  test('bulk revocation takes no identifiers', () => {
    expect(() => revokeOtherAccountSessionsSchema.parse({})).not.toThrow();
    expect(() => revokeAllAccountSessionsSchema.parse({})).not.toThrow();
  });
});

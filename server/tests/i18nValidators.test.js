const { translateBatchSchema } = require('../validators/i18nValidators');

describe('i18nValidators.translateBatchSchema', () => {
  test('accepts bounded text batches', () => {
    expect(() => translateBatchSchema.parse({
      body: { texts: ['Hello', 'Cart'], language: 'hi' },
    })).not.toThrow();
  });

  test('requires at least one text', () => {
    expect(translateBatchSchema.safeParse({ body: { texts: [], language: 'hi' } }).success).toBe(false);
  });

  test('caps batches at 50 texts (cost guard)', () => {
    expect(translateBatchSchema.safeParse({
      body: { texts: Array.from({ length: 51 }, () => 'x'), language: 'hi' },
    }).success).toBe(false);
  });

  test('caps individual texts at 800 chars', () => {
    expect(translateBatchSchema.safeParse({
      body: { texts: ['x'.repeat(900)], language: 'hi' },
    }).success).toBe(false);
  });

  test('rejects unknown body fields (strict mode)', () => {
    expect(translateBatchSchema.safeParse({
      body: { texts: ['hi'], language: 'hi', isAdmin: true },
    }).success).toBe(false);
  });
});

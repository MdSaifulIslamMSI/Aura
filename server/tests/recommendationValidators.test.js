const {
  assistantRecommendationSchema,
  cartRecommendationSchema,
  recommendationEventSchema,
  recommendationLimitQuerySchema,
  searchRecommendationSchema,
  similarRecommendationSchema,
} = require('../validators/recommendationValidators');

describe('recommendationValidators event ingestion', () => {
  test('accepts well-formed engagement events', () => {
    expect(() => recommendationEventSchema.parse({
      body: { eventType: 'add_to_cart', productId: 'p-1', sourcePage: 'cart' },
    })).not.toThrow();
  });

  test('rejects unknown event types and pages', () => {
    expect(recommendationEventSchema.safeParse({
      body: { eventType: 'mind_read', productId: 'p-1' },
    }).success).toBe(false);
    expect(recommendationEventSchema.safeParse({
      body: { eventType: 'add_to_cart', sourcePage: 'narnia' },
    }).success).toBe(false);
  });

  test('rejects unknown body fields (strict mode)', () => {
    expect(recommendationEventSchema.safeParse({
      body: { eventType: 'add_to_cart', isAdmin: true },
    }).success).toBe(false);
  });

  test('limits are digit-only query strings', () => {
    expect(() => recommendationLimitQuerySchema.parse({ query: { limit: '8' } })).not.toThrow();
    expect(recommendationLimitQuerySchema.safeParse({ query: { limit: 'many' } }).success).toBe(false);
  });
});

describe('recommendationValidators surface schemas', () => {
  test('cart recommendations bound items and limits', () => {
    expect(() => cartRecommendationSchema.parse({
      body: { cartItems: [{ productId: 'p-1', quantity: 2 }], limit: 6 },
    })).not.toThrow();
    expect(cartRecommendationSchema.safeParse({ body: { limit: 99 } }).success).toBe(false);
  });

  test('search recommendations live in the query string', () => {
    expect(() => searchRecommendationSchema.parse({ query: { query: 'phones', limit: '6' } })).not.toThrow();
    expect(searchRecommendationSchema.safeParse({ query: { query: 'x'.repeat(500) } }).success).toBe(false);
  });

  test('similar items take the reference product as a param', () => {
    expect(() => similarRecommendationSchema.parse({ params: { productId: 'p-1' } })).not.toThrow();
    expect(similarRecommendationSchema.safeParse({ params: { productId: '' } }).success).toBe(false);
  });

  test('assistant recommendations accept conversation context', () => {
    expect(() => assistantRecommendationSchema.parse({
      body: { message: 'gift under 5000', limit: 6 },
    })).not.toThrow();
    expect(assistantRecommendationSchema.safeParse({ body: { limit: 99 } }).success).toBe(false);
  });
});

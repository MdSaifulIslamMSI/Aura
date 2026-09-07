const {
  bundleBuildSchema,
  createProductSchema,
  deleteProductSchema,
  getProductByIdSchema,
  productRecommendationSchema,
  productSearchSchema,
  trackSearchClickSchema,
  updateProductSchema,
  visualSearchSchema,
} = require('../validators/productValidators');

describe('productValidators.productSearchSchema', () => {
  test('accepts empty filters with relevance default', () => {
    const parsed = productSearchSchema.parse({ query: {} });
    expect(parsed.query.sort).toBe('relevance');
  });

  test('coerces numeric strings for pagination', () => {
    const parsed = productSearchSchema.parse({ query: { page: '2', limit: '24' } });
    expect(parsed.query.page).toBe(2);
    expect(parsed.query.limit).toBe(24);
  });

  test('rejects page numbers above the limit ceiling', () => {
    expect(productSearchSchema.safeParse({ query: { limit: '500' } }).success).toBe(false);
  });

  test('rejects negative prices and out-of-range ratings', () => {
    expect(productSearchSchema.safeParse({ query: { minPrice: '-5' } }).success).toBe(false);
    expect(productSearchSchema.safeParse({ query: { rating: '6' } }).success).toBe(false);
  });

  test('rejects unknown sort modes', () => {
    expect(productSearchSchema.safeParse({ query: { sort: 'random' } }).success).toBe(false);
  });
});

describe('productValidators identifier schemas', () => {
  test('getProductById accepts slug-style ids', () => {
    expect(() => getProductByIdSchema.parse({ params: { id: 'aura-phone_15.brand' } })).not.toThrow();
  });

  test('deleteProduct rejects ids with path separators (traversal guard)', () => {
    expect(deleteProductSchema.safeParse({ params: { id: '../../etc/passwd' } }).success).toBe(false);
  });

  test('deleteProduct rejects blank ids', () => {
    expect(deleteProductSchema.safeParse({ params: { id: '   ' } }).success).toBe(false);
  });
});

describe('productValidators.create/updateProductSchema', () => {
  const validCreate = {
    body: {
      title: 'Aura Phone 15',
      price: 54999,
      description: 'A flagship-grade Aura smartphone.',
      category: 'Phones',
      brand: 'Aura',
      image: 'https://cdn.example.com/p.png',
    },
  };

  test('create accepts a minimal valid product', () => {
    expect(() => createProductSchema.parse(validCreate)).not.toThrow();
  });

  test('create rejects short titles and descriptions', () => {
    expect(createProductSchema.safeParse({ body: { ...validCreate.body, title: 'AB' } }).success).toBe(false);
    expect(createProductSchema.safeParse({ body: { ...validCreate.body, description: 'short' } }).success).toBe(false);
  });

  test('create rejects invalid image URLs', () => {
    expect(createProductSchema.safeParse({ body: { ...validCreate.body, image: 'not-a-url' } }).success).toBe(false);
  });

  test('update requires at least one field', () => {
    const result = updateProductSchema.safeParse({ params: { id: 'p-1' }, body: {} });
    expect(result.success).toBe(false);
  });

  test('update rejects unknown fields (strict mode)', () => {
    const result = updateProductSchema.safeParse({
      params: { id: 'p-1' },
      body: { title: 'New title', isAdmin: true },
    });
    expect(result.success).toBe(false);
  });
});

describe('productValidators media and engagement schemas', () => {
  test('visualSearch requires at least one image source', () => {
    expect(visualSearchSchema.safeParse({ body: {} }).success).toBe(false);
    expect(() => visualSearchSchema.parse({ body: { imageUrl: 'https://cdn.example.com/x.jpg' } })).not.toThrow();
  });

  test('bundleBuild enforces budget bounds', () => {
    expect(() => bundleBuildSchema.parse({ body: { theme: 'audio', budget: 20000 } })).not.toThrow();
    expect(bundleBuildSchema.safeParse({ body: { theme: 'x', budget: 20000 } }).success).toBe(false);
    expect(bundleBuildSchema.safeParse({ body: { theme: 'audio', budget: -5 } }).success).toBe(false);
  });

  test('recommendation caps history windows (abuse guard)', () => {
    const tooMuch = { body: { searchHistory: ['a', 'b', 'c', 'd', 'e', 'f'] } };
    expect(productRecommendationSchema.safeParse(tooMuch).success).toBe(false);
  });

  test('trackSearchClick accepts click telemetry', () => {
    expect(() => trackSearchClickSchema.parse({
      body: { searchEventId: 'evt-123', productId: 'p-1', position: 0 },
    })).not.toThrow();
  });
});

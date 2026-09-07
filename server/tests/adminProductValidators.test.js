const {
  adminCreateProductSchema,
  adminDeleteProductSchema,
  adminProductDetailSchema,
  adminProductListSchema,
  adminUpdateProductCoreSchema,
  adminUpdateProductPricingSchema,
} = require('../validators/adminProductValidators');

const validCreate = {
  title: 'Aura Phone 15', price: 54999, description: 'A flagship-grade Aura smartphone.',
  category: 'Phones', brand: 'Aura', image: 'https://cdn.example.com/p.png',
};

describe('adminProductValidators reads', () => {
  test('listings paginate with bounded sorts and sources', () => {
    expect(() => adminProductListSchema.parse({ query: { page: '2', sort: 'price-desc', source: 'manual' } })).not.toThrow();
    expect(adminProductListSchema.safeParse({ query: { sort: 'random', limit: '500' } }).success).toBe(false);
  });

  test('detail validates product identifiers', () => {
    expect(() => adminProductDetailSchema.parse({ params: { id: 'p-1' } })).not.toThrow();
    expect(adminProductDetailSchema.safeParse({ params: { id: '' } }).success).toBe(false);
  });

  test('deletes validate identifiers', () => {
    expect(() => adminDeleteProductSchema.parse({ params: { id: 'p-1' } })).not.toThrow();
  });
});

describe('adminProductValidators writes', () => {
  test('create enforces title, price, description and category floors', () => {
    expect(() => adminCreateProductSchema.parse({ body: validCreate })).not.toThrow();
    expect(adminCreateProductSchema.safeParse({ body: { ...validCreate, title: 'AB' } }).success).toBe(false);
    expect(adminCreateProductSchema.safeParse({ body: { ...validCreate, price: -1 } }).success).toBe(false);
    expect(adminCreateProductSchema.safeParse({ body: { ...validCreate, description: 'short' } }).success).toBe(false);
  });

  test('core updates scope to ids and require content', () => {
    expect(() => adminUpdateProductCoreSchema.parse({ params: { id: 'p-1' }, body: { title: 'New title here' } })).not.toThrow();
    expect(adminUpdateProductCoreSchema.safeParse({ params: { id: 'p-1' }, body: {} }).success).toBe(false);
    expect(adminUpdateProductCoreSchema.safeParse({ params: { id: 'p-1' }, body: { discountPercentage: 150 } }).success).toBe(false);
  });

  test('pricing updates require prices and audit reasons', () => {
    expect(() => adminUpdateProductPricingSchema.parse({
      params: { id: 'p-1' }, body: { price: 10, reason: 'Festive price drop' },
    })).not.toThrow();
    expect(adminUpdateProductPricingSchema.safeParse({
      params: { id: 'p-1' }, body: { originalPrice: -1, reason: 'Festive price drop' },
    }).success).toBe(false);
    expect(adminUpdateProductPricingSchema.safeParse({
      params: { id: 'p-1' }, body: { price: 10 },
    }).success).toBe(false);
  });
});

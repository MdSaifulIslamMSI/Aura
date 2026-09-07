const AppError = require('../utils/AppError');
const {
  buildLegacyCartResponse,
  parseExpectedVersion,
  toLegacyCartItem,
} = require('../services/cartService');

describe('cartService.parseExpectedVersion', () => {
  test('returns null for missing versions (unconditional write)', () => {
    expect(parseExpectedVersion(undefined)).toBeNull();
    expect(parseExpectedVersion(null)).toBeNull();
    expect(parseExpectedVersion('')).toBeNull();
  });

  test('parses integer versions from strings and numbers', () => {
    expect(parseExpectedVersion('3')).toBe(3);
    expect(parseExpectedVersion(0)).toBe(0);
  });

  test('rejects negative, fractional and non-numeric versions with 400', () => {
    for (const bad of ['-1', '1.5', 'abc', -2]) {
      try {
        parseExpectedVersion(bad);
        throw new Error(`should have thrown for ${bad}`);
      } catch (error) {
        expect(error).toBeInstanceOf(AppError);
        expect(error.statusCode).toBe(400);
      }
    }
  });

  test('names the offending field in the error', () => {
    try {
      parseExpectedVersion('x', 'cartVersion');
      throw new Error('should have thrown');
    } catch (error) {
      expect(error.message).toMatch(/cartVersion/);
    }
  });
});

describe('cartService.toLegacyCartItem', () => {
  test('maps snapshot items to the legacy cart shape', () => {
    expect(toLegacyCartItem({
      productId: '101', title: 'Aura Phone', price: 54999, image: 'p.png',
      quantity: 2, stock: 8, brand: 'Aura', discountPercentage: 8,
    })).toMatchObject({
      id: 101, productId: 101, title: 'Aura Phone', price: 54999,
      quantity: 2, stock: 8, brand: 'Aura', availability: 'in_stock',
    });
  });

  test('clamps negative quantities and stock to zero', () => {
    const item = toLegacyCartItem({ productId: 1, quantity: -3, stock: -1 });
    expect(item.quantity).toBe(0);
    expect(item.stock).toBe(0);
  });

  test('falls back originalPrice to price when absent', () => {
    expect(toLegacyCartItem({ productId: 1, price: 500 }).originalPrice).toBe(500);
  });

  test('defaults missing items to empty legacy values', () => {
    expect(toLegacyCartItem()).toMatchObject({ id: 0, title: '', image: '', quantity: 0 });
  });
});

describe('cartService.buildLegacyCartResponse', () => {
  test('builds the legacy response with revision and market', () => {
    const response = buildLegacyCartResponse(
      { items: [{ productId: 7, price: 100, quantity: 1 }], version: 4, updatedAt: '2026-01-01' },
      { countryCode: 'IN', currency: 'INR', language: 'en' }
    );
    expect(response.items).toHaveLength(1);
    expect(response.revision).toBe(4);
    expect(response.syncedAt).toBe('2026-01-01');
    expect(response.market).toEqual({ countryCode: 'IN', currency: 'INR', language: 'en' });
  });

  test('handles empty snapshots and missing markets', () => {
    const response = buildLegacyCartResponse({}, null);
    expect(response.items).toEqual([]);
    expect(response.revision).toBe(0);
    expect(response.syncedAt).toBeNull();
    expect(response.market).toBeNull();
  });
});

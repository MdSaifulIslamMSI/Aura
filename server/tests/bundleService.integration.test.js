const Product = require('../models/Product');
const { generateSmartBundle } = require('../services/bundleService');

const audioProduct = (overrides = {}) => ({
  title: 'Audio Speaker', brand: 'Aura', category: 'Audio', price: 8000,
  image: 's.png', isPublished: true, stock: 5, rating: 4.5,
  externalId: `test-audio-${Math.random().toString(36).slice(2, 10)}`,
  ...overrides,
});

describe('bundleService integration', () => {
  test('builds a budget-respecting bundle from live catalog rows', async () => {
    await Product.create([
      audioProduct({ title: 'Audio Speaker', price: 8000 }),
      audioProduct({ title: 'Audio Earbuds', price: 3000 }),
      audioProduct({ title: 'Audio Mic', price: 5000 }),
    ]);

    const result = await generateSmartBundle('audio', 20000);
    expect(result.totalSpent).toBeLessThanOrEqual(20000);
    expect(result.bundle.length).toBeGreaterThan(0);
    expect(result.strategy).toContain('Knapsack');
  });

  test('returns an empty set for unknown themes', async () => {
    await Product.create([audioProduct()]);
    const result = await generateSmartBundle('xyz-no-such-theme', 20000);
    expect(result).toMatchObject({ bundle: [], totalSpent: 0 });
  });

  test('ignores unpublished and out-of-stock rows', async () => {
    await Product.create([
      audioProduct({ title: 'Audio Hidden', isPublished: false }),
      audioProduct({ title: 'Audio Gone', stock: 0 }),
    ]);
    const result = await generateSmartBundle('audio', 50000);
    expect(result.bundle).toEqual([]);
  });
});

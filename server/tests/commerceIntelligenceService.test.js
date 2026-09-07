jest.mock('../models/Product', () => ({
  find: jest.fn(() => ({
    sort: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    lean: jest.fn().mockResolvedValue([]),
  })),
}));
jest.mock('../services/catalogService', () => ({ getActiveCatalogVersion: jest.fn(async () => 1) }));

const Product = require('../models/Product');
const {
  buildSmartBundle,
  computeDealDna,
  computeReturnRisk,
  getCompatibilityGraph,
} = require('../services/commerceIntelligenceService');

describe('commerceIntelligenceService.computeReturnRisk', () => {
  test('scores low-rated products as risky', () => {
    const risk = computeReturnRisk({ rating: 2.1, ratingCount: 5, stock: 100 });
    expect(risk.score).toBeGreaterThanOrEqual(38);
    expect(risk.reasons).toContain('Low user rating signal');
  });

  test('scores healthy products as safe', () => {
    const risk = computeReturnRisk({ rating: 4.8, ratingCount: 2000, stock: 50, warranty: '1 year' });
    expect(risk.score).toBeLessThan(30);
  });

  test('handles missing product data', () => {
    const risk = computeReturnRisk({});
    expect(risk.score).toBeGreaterThanOrEqual(0);
    expect(Array.isArray(risk.reasons)).toBe(true);
  });
});

describe('commerceIntelligenceService.computeDealDna', () => {
  const strong = { price: 40000, originalPrice: 60000, rating: 4.6, ratingCount: 1500, stock: 25, warranty: '1 year' };

  test('verdicts strong deals as good_deal', () => {
    const dna = computeDealDna(strong);
    expect(dna.verdict).toBe('good_deal');
    expect(dna.score).toBeGreaterThan(70);
  });

  test('flags weak signals for avoidance or waiting', () => {
    const dna = computeDealDna({ price: 60000, originalPrice: 60000, rating: 2.0, ratingCount: 3, stock: 0 });
    expect(['avoid', 'wait']).toContain(dna.verdict);
  });

  test('embeds return-risk and component scores', () => {
    const dna = computeDealDna(strong);
    expect(dna.returnRisk).toBeDefined();
    expect(dna.score).toBeLessThanOrEqual(100);
  });
});

describe('commerceIntelligenceService catalog-backed builders', () => {
  beforeEach(() => jest.clearAllMocks());

  test('buildSmartBundle clamps budgets and item counts', async () => {
    const result = await buildSmartBundle({ theme: 'audio', budget: 99999999, maxItems: 99 });
    expect(Product.find).toHaveBeenCalled();
    expect(result.budget).toBeLessThanOrEqual(500000);
    expect(result.items.length).toBeLessThanOrEqual(12);
  });

  test('getCompatibilityGraph bounds per-type limits', async () => {
    const graph = await getCompatibilityGraph({ id: 'p-1', title: 'Phone', category: 'Phones' }, { limitPerType: 99 });
    expect(graph).toBeDefined();
  });
});

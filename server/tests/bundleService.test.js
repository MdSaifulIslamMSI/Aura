jest.mock('../models/Product', () => ({ find: jest.fn() }));
jest.mock('../services/marketplaceOptimizers', () => ({ solveAuraBundle: jest.fn() }));

const Product = require('../models/Product');
const { solveAuraBundle } = require('../services/marketplaceOptimizers');
const { generateSmartBundle } = require('../services/bundleService');

const leanChain = (rows) => ({ limit: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue(rows) }) });

describe('bundleService.generateSmartBundle', () => {
  beforeEach(() => jest.clearAllMocks());

  test('returns an empty bundle when no candidates match', async () => {
    Product.find.mockReturnValue(leanChain([]));
    await expect(generateSmartBundle('audio', 20000)).resolves.toEqual({
      bundle: [],
      totalSpent: 0,
      strategy: 'Empty Candidate Set',
    });
    expect(solveAuraBundle).not.toHaveBeenCalled();
  });

  test('queries published in-stock products matching the theme', async () => {
    Product.find.mockReturnValue(leanChain([]));
    await generateSmartBundle('Audio', 20000);
    const filter = Product.find.mock.calls[0][0];
    expect(filter.isPublished).toBe(true);
    expect(filter.stock).toEqual({ $gt: 0 });
    expect(filter.$or).toHaveLength(3);
  });

  test('scores candidates and solves the knapsack within budget', async () => {
    Product.find.mockReturnValue(leanChain([
      { id: 'p-1', title: 'Speaker', price: 8000, image: 's.png', rating: 5, discountPercentage: 20 },
      { id: 'p-2', title: 'Earbuds', price: 3000, image: 'e.png', rating: 4, discountPercentage: 0 },
    ]));
    solveAuraBundle.mockReturnValue({ bundle: [{ id: 'p-1' }], totalSpent: 8000, unusedBudget: 12000 });

    const result = await generateSmartBundle('audio', 20000);

    expect(solveAuraBundle).toHaveBeenCalledTimes(1);
    const [candidates, budget] = solveAuraBundle.mock.calls[0];
    expect(budget).toBe(20000);
    expect(candidates).toEqual([
      expect.objectContaining({ id: 'p-1', utilityScore: 5 * 80 }),
      expect.objectContaining({ id: 'p-2', utilityScore: 4 * 100 }),
    ]);
    expect(result).toMatchObject({
      theme: 'audio',
      requestedBudget: 20000,
      totalSpent: 8000,
      unusedBudget: 12000,
      efficiencyScore: 40,
      strategy: 'Aura-Bundle (Heuristic Knapsack)',
    });
  });

  test('defaults missing ratings to 4 stars', async () => {
    Product.find.mockReturnValue(leanChain([{ id: 'p-9', title: 'Mic', price: 5000, image: 'm.png' }]));
    solveAuraBundle.mockReturnValue({ bundle: [], totalSpent: 0, unusedBudget: 10000 });

    await generateSmartBundle('audio', 10000);
    expect(solveAuraBundle.mock.calls[0][0][0].utilityScore).toBe(4 * 100);
  });
});

const { calculateOptimalLogisticsCost } = require('../services/logisticsOptimizer');

describe('logisticsOptimizer.calculateOptimalLogisticsCost', () => {
  test('prices a single cheap item into the small box tier', async () => {
    const result = await calculateOptimalLogisticsCost([{ price: 500, quantity: 1 }]);
    expect(result.shippingFee).toBeGreaterThan(0);
    expect(result.insights.strategy).toEqual(expect.any(String));
    expect(result.insights.packingStrategy).toEqual(expect.any(String));
  });

  test('scales fees with basket value and size', async () => {
    const single = await calculateOptimalLogisticsCost([{ price: 1000, quantity: 1 }]);
    const bulk = await calculateOptimalLogisticsCost([
      { price: 20000, quantity: 1 },
      { price: 15000, quantity: 2 },
      { price: 30000, quantity: 1 },
    ]);
    expect(bulk.shippingFee).toBeGreaterThan(single.shippingFee);
  });

  test('reports non-negative savings and eco badges', async () => {
    const result = await calculateOptimalLogisticsCost([{ price: 8000, quantity: 1 }]);
    expect(result.insights.savings).toBeGreaterThanOrEqual(0);
    expect(result.insights.ecoBadge).toContain('CO2 avoided');
  });

  test('handles empty baskets without crashing', async () => {
    const result = await calculateOptimalLogisticsCost([]);
    expect(result.shippingFee).toBeGreaterThanOrEqual(0);
  });
});

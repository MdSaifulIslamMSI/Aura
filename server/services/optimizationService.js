/**
 * optimizationService.js
 * 
 * Centralized service for solving NP-hard combinatorial optimization problems.
 * Currently supports:
 * - 0/1 Knapsack (Budget Allocation)
 * - Diversity Rebalancing (Greedy + Knapsack)
 */

/**
 * Solves the 0/1 Knapsack Problem.
 * Given a set of items, each with a weight (cost) and a value,
 * determines the number of each item to include in a collection so that 
 * the total weight is less than or equal to a given limit and the total value is as large as possible.
 * 
 * @param {Array} items - Array of { cost: number, value: number, ... }
 * @param {number} capacity - Maximum capacity (budget)
 * @returns {Object} { selected: Array, totalValue: number, totalCost: number }
 */
const solveKnapsack = (items, capacity) => {
    const n = items.length;
    const dp = Array.from({ length: n + 1 }, () => Array(capacity + 1).fill(0));

    for (let i = 1; i <= n; i++) {
        const item = items[i - 1];
        for (let w = 0; w <= capacity; w++) {
            if (item.cost <= w) {
                dp[i][w] = Math.max(
                    item.value + dp[i - 1][w - item.cost],
                    dp[i - 1][w]
                );
            } else {
                dp[i][w] = dp[i - 1][w];
            }
        }
    }

    // Backtrack to find selected items
    const selected = [];
    let w = capacity;
    for (let i = n; i > 0 && w > 0; i--) {
        if (dp[i][w] !== dp[i - 1][w]) {
            selected.push(items[i - 1]);
            w -= items[i - 1].cost;
        }
    }

    return {
        selected,
        totalValue: dp[n][capacity],
        totalCost: capacity - w
    };
};

/**
 * Solves a "Bundle Optimization" problem.
 * Finds the best products to fit in a user's budget while maximizing a score
 * (e.g., rating, discount, or deal DNA).
 * 
 * @param {Array} products - Catalog products
 * @param {number} budget - Maximum budget
 * @returns {Object} Optimized bundle result
 */
const optimizeProductBundle = (products, budget) => {
    if (!Array.isArray(products) || products.length === 0) return null;

    // Map products to Knapsack items
    // Cost = Price, Value = Heuristic score (Rating * Discount * Demand)
    const items = products.map(p => ({
        id: p._id || p.id,
        title: p.title,
        cost: Math.round(Number(p.price || 0)),
        value: Math.round(
            (Number(p.rating || 0) * 10) + 
            (Number(p.discountPercentage || 0) * 2) +
            (p.isAuraVerified ? 20 : 0)
        ),
        original: p
    })).filter(i => i.cost > 0 && i.cost <= budget);

    if (items.length === 0) return null;

    const result = solveKnapsack(items, Math.round(budget));
    
    return {
        items: result.selected.map(i => i.original),
        totalPrice: result.totalCost,
        totalValueScore: result.totalValue,
        budgetUtilization: ((result.totalCost / budget) * 100).toFixed(2),
        itemCount: result.selected.length
    };
};

module.exports = {
    solveKnapsack,
    optimizeProductBundle
};

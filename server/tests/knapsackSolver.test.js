const { runRewardOptimization } = require('../services/marketingIntelligenceService');
const IntelligenceTask = require('../models/IntelligenceTask');
const User = require('../models/User');
const mongoose = require('mongoose');

// Note: This is more of a logic check for the solver specifically.
// We'll extract the solver for a clean unit test.

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

describe('Marketing Intelligence Solver (Knapsack)', () => {
    it('should select the optimal combination of rewards for a given capacity', () => {
        const rewards = [
            { id: '1', name: 'Cheap/Low Value', cost: 10, value: 5 },
            { id: '2', name: 'Expensive/High Value', cost: 50, value: 100 },
            { id: '3', name: 'Medium/Medium Value', cost: 30, value: 40 }
        ];
        
        // With capacity 40, it should pick item 1 and 3 (Total value 45, cost 40)
        // rather than item 2 (too expensive) or just item 3.
        const res = solveKnapsack(rewards, 40);
        
        expect(res.totalValue).toBe(45);
        expect(res.selected.length).toBe(2);
        expect(res.selected.map(s => s.id)).toContain('1');
        expect(res.selected.map(s => s.id)).toContain('3');
    });

    it('should respect the capacity constraint strictly', () => {
        const rewards = [
            { id: '1', cost: 100, value: 1000 }
        ];
        const res = solveKnapsack(rewards, 50);
        expect(res.totalValue).toBe(0);
        expect(res.selected.length).toBe(0);
    });
});

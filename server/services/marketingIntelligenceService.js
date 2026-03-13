const logger = require('../utils/logger');
const IntelligenceTask = require('../models/IntelligenceTask');
const User = require('../models/User');

/**
 * Solves the 0/1 Knapsack Problem for Reward Optimization.
 * Given a budget (User Loyalty Points) and a set of available rewards (Coupons),
 * find the combination that maximizes the total value for the user.
 * 
 * Heuristic approach for speed while maintaining high quality results.
 */
const { solveKnapsack } = require('./optimizationService');

const runRewardOptimization = async (taskId) => {
    const task = await IntelligenceTask.findById(taskId);
    if (!task) return;

    try {
        task.status = 'processing';
        task.startedAt = new Date();
        await task.save();

        const user = await User.findById(task.userId);
        if (!user) throw new Error('User not found');

        // Mock Available Coupons (In a real app, these would come from a Coupon model)
        const availableCoupons = [
            { id: 'C1', name: 'FLAT ₹500 OFF', value: 500, cost: 2000 },
            { id: 'C2', name: '10% OFF Electronics', value: 800, cost: 3500 },
            { id: 'C3', name: 'Free Shipping (3 orders)', value: 300, cost: 1000 },
            { id: 'C4', name: 'Buy 1 Get 1 Clothing', value: 1200, cost: 5000 },
            { id: 'C5', name: '₹100 Cashback', value: 100, cost: 500 },
            { id: 'C6', name: 'Aura Premium (1 month)', value: 1500, cost: 7000 }
        ];

        // Capacity is the user's loyalty point balance
        const capacity = user.loyaltyPoints || 4000; // Defaulting for demo if 0

        const result = solveKnapsack(availableCoupons, capacity);

        task.status = 'completed';
        task.result = result;
        task.completedAt = new Date();
        await task.save();

        logger.info('marketing_intelligence.optimization_success', { 
            userId: user._id, 
            taskId: task._id,
            efficiency: (result.totalValue / result.totalCost).toFixed(2)
        });

    } catch (error) {
        task.status = 'failed';
        task.error = error.message;
        await task.save();
        logger.error('marketing_intelligence.optimization_failed', { taskId, error: error.message });
    }
};

const IntelligenceTaskMonitor = () => {
    let isRunning = false;

    const poll = async () => {
        if (isRunning) return;
        isRunning = true;

        try {
            const pendingTask = await IntelligenceTask.findOne({ status: 'pending' }).sort({ createdAt: 1 });
            if (pendingTask) {
                if (pendingTask.type === 'reward_optimization') {
                    await runRewardOptimization(pendingTask._id);
                }
            }
        } catch (error) {
            logger.error('intelligence_monitor.poll_failed', { error: error.message });
        } finally {
            isRunning = false;
        }
    };

    const interval = setInterval(poll, 30000); // 30 seconds
    return () => clearInterval(interval);
};

module.exports = {
    IntelligenceTaskMonitor,
    runRewardOptimization
};

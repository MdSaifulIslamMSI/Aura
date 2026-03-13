const express = require('express');
const router = express.Router();
const IntelligenceTask = require('../models/IntelligenceTask');
const { protect } = require('../middleware/authMiddleware');
const asyncHandler = require('express-async-handler');

// @desc    Trigger a reward optimization task
// @route   POST /api/intelligence/optimize-rewards
// @access  Private
router.post('/optimize-rewards', protect, asyncHandler(async (req, res) => {
    // Prevent duplicate pending tasks for the same user
    const existingTask = await IntelligenceTask.findOne({
        userId: req.user._id,
        type: 'reward_optimization',
        status: { $in: ['pending', 'processing'] }
    });

    if (existingTask) {
        return res.status(400).json({
            message: 'Optimization task already in progress',
            taskId: existingTask._id
        });
    }

    const task = await IntelligenceTask.create({
        type: 'reward_optimization',
        userId: req.user._id,
        status: 'pending'
    });

    res.status(202).json({
        message: 'Reward optimization triggered',
        taskId: task._id
    });
}));

// @desc    Get the latest reward optimization result
// @route   GET /api/intelligence/latest-rewards
// @access  Private
router.get('/latest-rewards', protect, asyncHandler(async (req, res) => {
    const latestTask = await IntelligenceTask.findOne({
        userId: req.user._id,
        type: 'reward_optimization',
        status: 'completed'
    }).sort({ completedAt: -1 });

    if (!latestTask) {
        return res.status(404).json({ message: 'No optimization results found' });
    }

    res.json(latestTask.result);
}));

// @desc    Get intelligence configuration (weights and thresholds)
// @route   GET /api/intelligence/config
// @access  Public
router.get('/config', asyncHandler(async (req, res) => {
    res.json({
        weights: {
            priceScore: 0.28,
            ratingScore: 0.24,
            reviewConfidence: 0.14,
            stockHealth: 0.14,
            warrantyBoost: 0.08,
            riskPenalty: 0.12
        },
        thresholds: {
            goodDeal: 70,
            avoid: 45
        }
    });
}));

module.exports = router;

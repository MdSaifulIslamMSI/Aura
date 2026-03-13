const mongoose = require('mongoose');

const intelligenceTaskSchema = new mongoose.Schema({
    type: {
        type: String,
        required: true,
        enum: ['reward_optimization', 'logistics_optimization', 'inventory_rebalance'],
        index: true
    },
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        index: true
    },
    status: {
        type: String,
        required: true,
        enum: ['pending', 'processing', 'completed', 'failed'],
        default: 'pending',
        index: true
    },
    inputParams: {
        type: mongoose.Schema.Types.Mixed,
        default: {}
    },
    result: {
        type: mongoose.Schema.Types.Mixed
    },
    error: {
        type: String
    },
    startedAt: {
        type: Date
    },
    completedAt: {
        type: Date
    },
    workerId: {
        type: String
    }
}, {
    timestamps: true
});

// Index for the worker to find pending tasks efficiently
intelligenceTaskSchema.index({ status: 1, createdAt: 1 });

const IntelligenceTask = mongoose.model('IntelligenceTask', intelligenceTaskSchema);

module.exports = IntelligenceTask;

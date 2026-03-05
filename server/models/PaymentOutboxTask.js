const mongoose = require('mongoose');

const paymentOutboxTaskSchema = new mongoose.Schema({
    taskType: { type: String, enum: ['capture', 'refund', 'reconcile'], required: true, index: true },
    intentId: { type: String, required: true, index: true },
    payload: { type: mongoose.Schema.Types.Mixed, default: {} },
    retryCount: { type: Number, default: 0 },
    nextRunAt: { type: Date, default: Date.now, index: true },
    lastError: { type: String, default: '' },
    status: { type: String, enum: ['pending', 'processing', 'done', 'failed'], default: 'pending', index: true },
    lockedAt: { type: Date, default: null },
    lockedBy: { type: String, default: null },
}, { timestamps: true });

paymentOutboxTaskSchema.index({ status: 1, nextRunAt: 1, lockedAt: 1 });
paymentOutboxTaskSchema.index(
    { taskType: 1, intentId: 1 },
    {
        unique: true,
        partialFilterExpression: {
            taskType: 'capture',
            status: { $in: ['pending', 'processing'] },
        },
    }
);

module.exports = mongoose.model('PaymentOutboxTask', paymentOutboxTaskSchema);

const mongoose = require('mongoose');

const idempotencyRecordSchema = new mongoose.Schema({
    key: { type: String, required: true },
    user: { type: String, required: true },
    route: { type: String, required: true },
    requestHash: { type: String, required: true },
    statusCode: { type: Number, required: true, default: 200 },
    response: { type: mongoose.Schema.Types.Mixed, default: {} },
    processedAt: { type: Date, default: Date.now },
    expiresAt: { type: Date, required: true, default: () => new Date(Date.now() + (24 * 60 * 60 * 1000)) },
}, { timestamps: true });

idempotencyRecordSchema.index({ key: 1, user: 1, route: 1 }, { unique: true });
idempotencyRecordSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model('IdempotencyRecord', idempotencyRecordSchema);


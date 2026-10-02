const mongoose = require('mongoose');

const CHECK_STATUSES = [
    'operational',
    'degraded',
    'degraded_performance',
    'partial_outage',
    'major_outage',
    'maintenance',
];

const statusCheckSchema = new mongoose.Schema({
    componentId: { type: mongoose.Schema.Types.ObjectId, ref: 'StatusComponent', required: true, index: true },
    status: { type: String, enum: CHECK_STATUSES, required: true },
    responseTimeMs: { type: Number, default: null },
    httpStatusCode: { type: Number, default: null },
    errorMessage: { type: String, default: '', maxlength: 500 },
    // checkedAt indexing is owned by the TTL migration (ttl_checkedAt_2d);
    // a field-level index here would duplicate it.
    checkedAt: { type: Date, default: Date.now },
    region: { type: String, default: '', trim: true, maxlength: 80 },
}, { timestamps: true });

statusCheckSchema.index({ componentId: 1, checkedAt: -1 });

module.exports = mongoose.model('StatusCheck', statusCheckSchema);

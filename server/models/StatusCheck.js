const mongoose = require('mongoose');

const CHECK_STATUSES = [
    'operational',
    'degraded_performance',
    'partial_outage',
    'major_outage',
    'maintenance',
];

const statusCheckSchema = new mongoose.Schema({
    componentId: { type: mongoose.Schema.Types.ObjectId, ref: 'StatusComponent', required: true, index: true },
    status: { type: String, enum: CHECK_STATUSES, required: true, index: true },
    responseTimeMs: { type: Number, default: null },
    httpStatusCode: { type: Number, default: null },
    errorMessage: { type: String, default: '', maxlength: 500 },
    checkedAt: { type: Date, default: Date.now, index: true },
    region: { type: String, default: '', trim: true, maxlength: 80 },
}, { timestamps: true });

statusCheckSchema.index({ componentId: 1, checkedAt: -1 });
statusCheckSchema.index({ status: 1, checkedAt: -1 });

module.exports = mongoose.model('StatusCheck', statusCheckSchema);

const mongoose = require('mongoose');

const DAY_STATUSES = [
    'operational',
    'degraded',
    'partial_outage',
    'major_outage',
    'maintenance',
    'unknown',
];

const statusDailyMetricSchema = new mongoose.Schema({
    componentId: { type: mongoose.Schema.Types.ObjectId, ref: 'StatusComponent', required: true, index: true },
    date: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/, index: true },
    uptimePercent: { type: Number, default: 0, min: 0, max: 100 },
    status: { type: String, enum: DAY_STATUSES, default: 'unknown', index: true },
    totalChecks: { type: Number, default: 0, min: 0 },
    successfulChecks: { type: Number, default: 0, min: 0 },
    failedChecks: { type: Number, default: 0, min: 0 },
    degradedChecks: { type: Number, default: 0, min: 0 },
    avgResponseTimeMs: { type: Number, default: null },
    downtimeMinutes: { type: Number, default: 0, min: 0 },
}, { timestamps: true });

statusDailyMetricSchema.index({ componentId: 1, date: 1 }, { unique: true });
statusDailyMetricSchema.index({ date: -1, status: 1 });

module.exports = mongoose.model('StatusDailyMetric', statusDailyMetricSchema);
module.exports.DAY_STATUSES = DAY_STATUSES;

const mongoose = require('mongoose');

const COMPONENT_STATUSES = [
    'operational',
    'degraded',
    'degraded_performance',
    'partial_outage',
    'major_outage',
    'maintenance',
];

const CHECK_TYPES = [
    'http',
    'database',
    'redis',
    'internal_health',
    'manual',
];

const statusComponentSchema = new mongoose.Schema({
    groupId: { type: mongoose.Schema.Types.ObjectId, ref: 'StatusComponentGroup', required: true, index: true },
    name: { type: String, required: true, trim: true, maxlength: 120 },
    slug: { type: String, required: true, trim: true, lowercase: true, unique: true, index: true, maxlength: 160 },
    description: { type: String, default: '', trim: true, maxlength: 500 },
    checkType: { type: String, enum: CHECK_TYPES, default: 'manual', index: true },
    checkUrl: { type: String, default: '', trim: true, maxlength: 500 },
    checkMethod: { type: String, enum: ['GET', 'HEAD', 'POST'], default: 'GET' },
    expectedStatusCode: { type: Number, default: 200, min: 100, max: 599 },
    timeoutMs: { type: Number, default: 5000, min: 250, max: 30000 },
    dependencies: [{ type: String, trim: true, lowercase: true, maxlength: 160 }],
    isPublic: { type: Boolean, default: true, index: true },
    isMonitored: { type: Boolean, default: true, index: true },
    manualStatusOverride: { type: String, enum: [...COMPONENT_STATUSES, null], default: null },
    currentStatus: { type: String, enum: COMPONENT_STATUSES, default: 'operational', index: true },
    lastCheckedAt: { type: Date, default: null },
    lastStatusChangeAt: { type: Date, default: null },
    lastSuccessAt: { type: Date, default: null },
    lastFailureAt: { type: Date, default: null },
    lastResponseTimeMs: { type: Number, default: null },
    consecutiveFailures: { type: Number, default: 0, min: 0 },
    order: { type: Number, default: 0, index: true },
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
}, { timestamps: true });

statusComponentSchema.index({ groupId: 1, order: 1, name: 1 });
statusComponentSchema.index({ isPublic: 1, isMonitored: 1, order: 1 });

statusComponentSchema.virtual('status')
    .get(function getStatus() {
        return this.currentStatus;
    })
    .set(function setStatus(value) {
        this.currentStatus = value;
    });

statusComponentSchema.virtual('public')
    .get(function getPublic() {
        return this.isPublic;
    })
    .set(function setPublic(value) {
        this.isPublic = value;
    });

statusComponentSchema.pre('save', function setStatusChangeTimestamp() {
    if (this.isModified('currentStatus') || this.isModified('manualStatusOverride')) {
        this.lastStatusChangeAt = new Date();
    }
});

module.exports = mongoose.model('StatusComponent', statusComponentSchema);
module.exports.COMPONENT_STATUSES = COMPONENT_STATUSES;
module.exports.CHECK_TYPES = CHECK_TYPES;

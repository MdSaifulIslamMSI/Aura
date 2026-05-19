const mongoose = require('mongoose');

const INCIDENT_STATUSES = [
    'investigating',
    'identified',
    'monitoring',
    'resolved',
];

const INCIDENT_IMPACTS = [
    'none',
    'minor',
    'major',
    'critical',
    'maintenance',
];

const statusIncidentSchema = new mongoose.Schema({
    title: { type: String, required: true, trim: true, maxlength: 180 },
    slug: { type: String, required: true, trim: true, lowercase: true, unique: true, index: true, maxlength: 220 },
    description: { type: String, default: '', trim: true, maxlength: 5000 },
    impact: { type: String, enum: INCIDENT_IMPACTS, default: 'minor', index: true },
    status: { type: String, enum: INCIDENT_STATUSES, default: 'investigating', index: true },
    affectedComponentIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'StatusComponent', index: true }],
    startedAt: { type: Date, default: Date.now, index: true },
    resolvedAt: { type: Date, default: null, index: true },
    scheduledStartAt: { type: Date, default: null },
    scheduledEndAt: { type: Date, default: null },
    isPublic: { type: Boolean, default: true, index: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    resolutionSummary: { type: String, default: '', trim: true, maxlength: 5000 },
}, { timestamps: true });

statusIncidentSchema.index({ isPublic: 1, status: 1, startedAt: -1 });
statusIncidentSchema.index({ impact: 1, status: 1, startedAt: -1 });

module.exports = mongoose.model('StatusIncident', statusIncidentSchema);
module.exports.INCIDENT_STATUSES = INCIDENT_STATUSES;
module.exports.INCIDENT_IMPACTS = INCIDENT_IMPACTS;

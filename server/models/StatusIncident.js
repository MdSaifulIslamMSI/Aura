const mongoose = require('mongoose');

const INCIDENT_STATUSES = [
    'investigating',
    'identified',
    'monitoring',
    'resolved',
];

const INCIDENT_SEVERITIES = [
    'SEV1',
    'SEV2',
    'SEV3',
    'SEV4',
];

const INCIDENT_IMPACTS = [
    'none',
    'minor',
    'major',
    'critical',
    'maintenance',
];

const INCIDENT_SOURCES = [
    'manual',
    'uptime_kuma',
    'gatus',
    'sentry',
    'github_actions',
    'synthetic',
    'alertmanager',
];

const INCIDENT_TIMELINE_TYPES = [
    'detected',
    'status_update',
    'mitigation',
    'deployment',
    'monitor_recovered',
    'resolved',
    'internal_note',
    'postmortem',
];

const incidentTimelineSchema = new mongoose.Schema({
    at: { type: Date, default: Date.now, index: true },
    type: { type: String, enum: INCIDENT_TIMELINE_TYPES, default: 'status_update', index: true },
    message: { type: String, required: true, trim: true, maxlength: 5000 },
    public: { type: Boolean, default: true, index: true },
    actor: { type: String, default: '', trim: true, maxlength: 160 },
    deployment: {
        workflow: { type: String, default: '', trim: true, maxlength: 160 },
        conclusion: { type: String, default: '', trim: true, maxlength: 80 },
        sha: { type: String, default: '', trim: true, maxlength: 80 },
        url: { type: String, default: '', trim: true, maxlength: 500 },
    },
}, { _id: false });

const statusIncidentSchema = new mongoose.Schema({
    title: { type: String, required: true, trim: true, maxlength: 180 },
    slug: { type: String, required: true, trim: true, lowercase: true, unique: true, index: true, maxlength: 220 },
    description: { type: String, default: '', trim: true, maxlength: 5000 },
    severity: { type: String, enum: INCIDENT_SEVERITIES, default: 'SEV3', index: true },
    impact: { type: String, enum: INCIDENT_IMPACTS, default: 'minor', index: true },
    status: { type: String, enum: INCIDENT_STATUSES, default: 'investigating', index: true },
    affectedComponentIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'StatusComponent', index: true }],
    startedAt: { type: Date, default: Date.now, index: true },
    detectedAt: { type: Date, default: null, index: true },
    acknowledgedAt: { type: Date, default: null, index: true },
    resolvedAt: { type: Date, default: null, index: true },
    scheduledStartAt: { type: Date, default: null },
    scheduledEndAt: { type: Date, default: null },
    commander: { type: String, default: '', trim: true, maxlength: 160 },
    source: { type: String, enum: INCIDENT_SOURCES, default: 'manual', index: true },
    isPublic: { type: Boolean, default: true, index: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    summary: { type: String, default: '', trim: true, maxlength: 5000 },
    rootCause: { type: String, default: '', trim: true, maxlength: 5000 },
    mitigation: { type: String, default: '', trim: true, maxlength: 5000 },
    prevention: { type: String, default: '', trim: true, maxlength: 5000 },
    customerImpact: { type: String, default: '', trim: true, maxlength: 5000 },
    internalNotes: { type: String, default: '', trim: true, maxlength: 10000 },
    resolutionSummary: { type: String, default: '', trim: true, maxlength: 5000 },
    timeline: { type: [incidentTimelineSchema], default: [] },
    postmortem: {
        generatedAt: { type: Date, default: null },
        generatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
        markdown: { type: String, default: '', maxlength: 20000 },
        status: { type: String, enum: ['missing', 'draft', 'published'], default: 'missing' },
    },
}, { timestamps: true });

statusIncidentSchema.index({ isPublic: 1, status: 1, startedAt: -1 });
statusIncidentSchema.index({ severity: 1, status: 1, startedAt: -1 });
statusIncidentSchema.index({ impact: 1, status: 1, startedAt: -1 });

statusIncidentSchema.virtual('public')
    .get(function getPublic() {
        return this.isPublic;
    })
    .set(function setPublic(value) {
        this.isPublic = value;
    });

statusIncidentSchema.virtual('affectedComponents')
    .get(function getAffectedComponents() {
        return this.affectedComponentIds;
    })
    .set(function setAffectedComponents(value) {
        this.affectedComponentIds = value;
    });

module.exports = mongoose.model('StatusIncident', statusIncidentSchema);
module.exports.INCIDENT_STATUSES = INCIDENT_STATUSES;
module.exports.INCIDENT_SEVERITIES = INCIDENT_SEVERITIES;
module.exports.INCIDENT_IMPACTS = INCIDENT_IMPACTS;
module.exports.INCIDENT_SOURCES = INCIDENT_SOURCES;
module.exports.INCIDENT_TIMELINE_TYPES = INCIDENT_TIMELINE_TYPES;

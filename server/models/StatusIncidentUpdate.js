const mongoose = require('mongoose');

const { INCIDENT_STATUSES, INCIDENT_TIMELINE_TYPES } = require('./StatusIncident');

const statusIncidentUpdateSchema = new mongoose.Schema({
    incidentId: { type: mongoose.Schema.Types.ObjectId, ref: 'StatusIncident', required: true, index: true },
    status: { type: String, enum: INCIDENT_STATUSES, required: true, index: true },
    type: { type: String, enum: INCIDENT_TIMELINE_TYPES, default: 'status_update', index: true },
    message: { type: String, required: true, trim: true, maxlength: 5000 },
    isPublic: { type: Boolean, default: true, index: true },
    actor: { type: String, default: '', trim: true, maxlength: 160 },
    deployment: {
        workflow: { type: String, default: '', trim: true, maxlength: 160 },
        conclusion: { type: String, default: '', trim: true, maxlength: 80 },
        sha: { type: String, default: '', trim: true, maxlength: 80 },
        url: { type: String, default: '', trim: true, maxlength: 500 },
    },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
}, { timestamps: true });

statusIncidentUpdateSchema.index({ incidentId: 1, createdAt: -1 });

module.exports = mongoose.model('StatusIncidentUpdate', statusIncidentUpdateSchema);

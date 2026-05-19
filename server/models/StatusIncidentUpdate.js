const mongoose = require('mongoose');

const { INCIDENT_STATUSES } = require('./StatusIncident');

const statusIncidentUpdateSchema = new mongoose.Schema({
    incidentId: { type: mongoose.Schema.Types.ObjectId, ref: 'StatusIncident', required: true, index: true },
    status: { type: String, enum: INCIDENT_STATUSES, required: true, index: true },
    message: { type: String, required: true, trim: true, maxlength: 5000 },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
}, { timestamps: true });

statusIncidentUpdateSchema.index({ incidentId: 1, createdAt: -1 });

module.exports = mongoose.model('StatusIncidentUpdate', statusIncidentUpdateSchema);

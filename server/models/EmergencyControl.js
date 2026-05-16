const mongoose = require('mongoose');
const {
    DEFAULT_EMERGENCY_FLAGS,
    EMERGENCY_FLAG_KEYS,
    EMERGENCY_SCOPES,
    EMERGENCY_SEVERITIES,
} = require('../config/emergencyControlConstants');

const emergencyControlSchema = new mongoose.Schema({
    key: {
        type: String,
        enum: EMERGENCY_FLAG_KEYS,
        required: true,
        unique: true,
        index: true,
        trim: true,
        uppercase: true,
    },
    enabled: { type: Boolean, default: false, index: true },
    severity: {
        type: String,
        enum: EMERGENCY_SEVERITIES,
        required: true,
        default: 'low',
    },
    scope: {
        type: String,
        enum: EMERGENCY_SCOPES,
        required: true,
        default: 'global',
        index: true,
    },
    userMessage: { type: String, default: '', maxlength: 500 },
    internalReason: { type: String, default: '', maxlength: 2000, select: true },
    activatedByUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    activatedByEmail: { type: String, default: '', lowercase: true, trim: true },
    approvedByUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    approvedByEmail: { type: String, default: '', lowercase: true, trim: true },
    requiresDualApproval: { type: Boolean, default: false },
    startsAt: { type: Date, default: null, index: true },
    expiresAt: { type: Date, default: null, index: true },
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
}, {
    timestamps: true,
});

emergencyControlSchema.pre('validate', function applyEmergencyDefaults() {
    const defaults = DEFAULT_EMERGENCY_FLAGS[this.key] || {};
    if (!this.severity) this.severity = defaults.severity || 'low';
    if (!this.scope) this.scope = defaults.scope || 'global';
    if (!this.userMessage) this.userMessage = defaults.userMessage || '';
});

emergencyControlSchema.index({ enabled: 1, expiresAt: 1 });

module.exports = mongoose.model('EmergencyControl', emergencyControlSchema);

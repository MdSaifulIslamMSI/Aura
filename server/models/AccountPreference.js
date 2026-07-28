const mongoose = require('mongoose');

const channelSchema = new mongoose.Schema({
    email: { type: Boolean, default: true },
    sms: { type: Boolean, default: false },
    push: { type: Boolean, default: true },
}, { _id: false });

const consentAuditSchema = new mongoose.Schema({
    preference: { type: String, required: true, maxlength: 80 },
    channel: { type: String, required: true, enum: ['email', 'sms', 'push'] },
    enabled: { type: Boolean, required: true },
    changedAt: { type: Date, required: true },
}, { _id: false });

const accountPreferenceSchema = new mongoose.Schema({
    ownerKey: { type: String, required: true, unique: true, index: true, select: false },
    schemaVersion: { type: Number, default: 1, min: 1 },
    revision: { type: Number, default: 0, min: 0 },
    notifications: {
        orderUpdates: { type: channelSchema, default: () => ({}) },
        deliveryUpdates: { type: channelSchema, default: () => ({}) },
        returnRefundUpdates: { type: channelSchema, default: () => ({}) },
        marketplaceUpdates: { type: channelSchema, default: () => ({ email: true, push: true }) },
        productAlerts: { type: channelSchema, default: () => ({ email: false, push: true }) },
        marketing: { type: channelSchema, default: () => ({ email: false, sms: false, push: false }) },
        security: { type: channelSchema, default: () => ({ email: true, sms: true, push: true }) },
    },
    localization: {
        language: { type: String, default: 'en', maxlength: 12 },
        locale: { type: String, default: 'en-IN', maxlength: 24 },
        currency: { type: String, default: 'INR', minlength: 3, maxlength: 3 },
    },
    accessibility: {
        reducedMotion: { type: Boolean, default: false },
        highContrast: { type: Boolean, default: false },
    },
    consentAudit: {
        type: [consentAuditSchema],
        default: [],
        select: false,
    },
}, {
    timestamps: true,
    optimisticConcurrency: true,
});

accountPreferenceSchema.index({ updatedAt: -1 });

module.exports = mongoose.models.AccountPreference
    || mongoose.model('AccountPreference', accountPreferenceSchema);

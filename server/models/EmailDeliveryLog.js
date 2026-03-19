const crypto = require('crypto');
const mongoose = require('mongoose');

const webhookEventSchema = new mongoose.Schema({
    eventId: { type: String, default: '' },
    type: { type: String, default: '', index: true },
    occurredAt: { type: Date, default: Date.now },
    summary: { type: String, default: '' },
}, { _id: false });

const emailDeliveryLogSchema = new mongoose.Schema({
    deliveryId: {
        type: String,
        required: true,
        unique: true,
        index: true,
        default: () => `edl_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`,
    },
    eventType: {
        type: String,
        required: true,
        index: true,
    },
    status: {
        type: String,
        enum: ['sent', 'failed', 'skipped'],
        required: true,
        index: true,
    },
    lifecycleStatus: {
        type: String,
        enum: [
            'queued',
            'sent',
            'delivered',
            'delivery_delayed',
            'bounced',
            'complained',
            'opened',
            'clicked',
            'failed',
            'suppressed',
            'received',
            'skipped',
            'unknown',
        ],
        default: 'queued',
        index: true,
    },
    provider: {
        type: String,
        default: 'unknown',
        index: true,
    },
    recipientEmail: {
        type: String,
        default: '',
        index: true,
    },
    recipientMask: {
        type: String,
        default: '',
    },
    subject: {
        type: String,
        default: '',
    },
    requestId: {
        type: String,
        default: '',
        index: true,
    },
    securityTags: {
        type: [String],
        default: [],
    },
    providerMessageId: {
        type: String,
        default: '',
        index: true,
    },
    errorCode: {
        type: String,
        default: '',
        index: true,
    },
    errorMessage: {
        type: String,
        default: '',
    },
    responseSummary: {
        type: mongoose.Schema.Types.Mixed,
        default: {},
    },
    metaSummary: {
        type: mongoose.Schema.Types.Mixed,
        default: {},
    },
    lastWebhookType: {
        type: String,
        default: '',
        index: true,
    },
    lastWebhookAt: {
        type: Date,
        default: null,
        index: true,
    },
    providerWebhookEventIds: {
        type: [String],
        default: [],
    },
    webhookEvents: {
        type: [webhookEventSchema],
        default: [],
    },
}, { timestamps: true });

emailDeliveryLogSchema.index({ createdAt: -1, status: 1 });
emailDeliveryLogSchema.index({ eventType: 1, createdAt: -1 });
emailDeliveryLogSchema.index({ provider: 1, createdAt: -1 });
emailDeliveryLogSchema.index({ providerMessageId: 1, provider: 1 });
emailDeliveryLogSchema.index({ lifecycleStatus: 1, createdAt: -1 });

module.exports = mongoose.model('EmailDeliveryLog', emailDeliveryLogSchema);

const mongoose = require('mongoose');

const accountPrivacyJobSchema = new mongoose.Schema({
    user: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true,
    },
    type: {
        type: String,
        enum: ['export', 'deactivation', 'deletion'],
        required: true,
        index: true,
    },
    status: {
        type: String,
        enum: [
            'queued',
            'processing',
            'awaiting_grace',
            'ready',
            'completed',
            'cancelled',
            'failed',
            'blocked',
        ],
        default: 'queued',
        index: true,
    },
    idempotencyHash: {
        type: String,
        required: true,
        select: false,
    },
    policyVersion: {
        type: String,
        required: true,
    },
    manifestVersion: {
        type: Number,
        default: 1,
        min: 1,
    },
    requestedAt: {
        type: Date,
        default: Date.now,
    },
    graceEndsAt: {
        type: Date,
        default: null,
    },
    completedAt: {
        type: Date,
        default: null,
    },
    exportExpiresAt: {
        type: Date,
        default: null,
    },
    artifactKeyEncrypted: {
        type: String,
        default: '',
        select: false,
    },
    attempts: {
        type: Number,
        default: 0,
        min: 0,
        max: 20,
    },
    lockedAt: {
        type: Date,
        default: null,
    },
    workerId: {
        type: String,
        default: '',
        select: false,
    },
    failureCode: {
        type: String,
        default: '',
    },
    cancelledAt: {
        type: Date,
        default: null,
    },
}, {
    timestamps: true,
});

accountPrivacyJobSchema.index(
    { user: 1, type: 1, idempotencyHash: 1 },
    { unique: true, name: 'account_privacy_job_idempotency_unique' }
);
accountPrivacyJobSchema.index(
    { user: 1, type: 1, createdAt: -1, _id: -1 },
    { name: 'account_privacy_job_owner_history' }
);
accountPrivacyJobSchema.index(
    { status: 1, createdAt: 1, _id: 1 },
    { name: 'account_privacy_job_worker_queue' }
);

module.exports = mongoose.model('AccountPrivacyJob', accountPrivacyJobSchema);

const crypto = require('crypto');
const AccountPrivacyJob = require('../models/AccountPrivacyJob');
const AppError = require('../utils/AppError');
const { getAccountPrivacyActivation } = require('../config/accountPrivacyFlags');
const {
    hasAccountPrivacyHandler,
    getRegisteredAccountPrivacyJobTypes,
    getUnserviceableAccountPrivacyJobTypes,
} = require('./accountPrivacyHandlerRegistry');

const CANCELLABLE_STATUSES = Object.freeze(['queued', 'awaiting_grace', 'blocked', 'failed']);

const buildIdempotencyHash = ({ userId, type, idempotencyKey }) => crypto
    .createHash('sha256')
    .update(`${String(userId)}:${String(type)}:${String(idempotencyKey)}`)
    .digest('hex');

const serializePrivacyJob = (job = {}) => ({
    id: String(job._id || ''),
    type: String(job.type || ''),
    status: String(job.status || ''),
    policyVersion: String(job.policyVersion || ''),
    manifestVersion: Number(job.manifestVersion || 1),
    requestedAt: job.requestedAt || job.createdAt || null,
    graceEndsAt: job.graceEndsAt || null,
    completedAt: job.completedAt || null,
    exportExpiresAt: job.exportExpiresAt || null,
    failureCode: String(job.failureCode || ''),
    cancelledAt: job.cancelledAt || null,
});

const requireEnabledPolicy = () => {
    const activation = getAccountPrivacyActivation();
    if (!activation.enabled || !activation.policy) {
        const error = new AppError('Account privacy lifecycle is not available', 503);
        error.code = 'ACCOUNT_PRIVACY_POLICY_BLOCKED';
        throw error;
    }
    return activation;
};

// Fail closed on the request path too: without a registered handler nothing
// would ever service the job, so accepting it would promise the data subject
// a result the platform cannot deliver.
const requireServiceableJobType = (type) => {
    if (hasAccountPrivacyHandler(type)) {
        return;
    }
    const error = new AppError('This data-subject request is not available', 503);
    error.code = 'ACCOUNT_PRIVACY_UNSUPPORTED';
    throw error;
};

const createPrivacyJob = async ({ userId, type, idempotencyKey }) => {
    const activation = requireEnabledPolicy();
    requireServiceableJobType(type);
    const ownerId = String(userId || '').trim();
    const key = String(idempotencyKey || '').trim();
    if (!ownerId) throw new AppError('Not authorized', 401);
    if (key.length < 8 || key.length > 128) {
        throw new AppError('Idempotency-Key must be between 8 and 128 characters', 400);
    }
    const idempotencyHash = buildIdempotencyHash({
        userId: ownerId,
        type,
        idempotencyKey: key,
    });
    const existing = await AccountPrivacyJob.findOne({
        user: ownerId,
        type,
        idempotencyHash,
    }).lean();
    if (existing) return { job: serializePrivacyJob(existing), replayed: true };

    const now = new Date();
    const graceEndsAt = type === 'deletion'
        ? new Date(now.getTime() + activation.policy.deletionGraceDays * 24 * 60 * 60 * 1000)
        : null;
    try {
        const created = await AccountPrivacyJob.create({
            user: ownerId,
            type,
            status: type === 'deletion' ? 'awaiting_grace' : 'queued',
            idempotencyHash,
            policyVersion: activation.policy.version,
            manifestVersion: 1,
            requestedAt: now,
            graceEndsAt,
        });
        return { job: serializePrivacyJob(created), replayed: false };
    } catch (error) {
        if (Number(error?.code) !== 11000) throw error;
        const replay = await AccountPrivacyJob.findOne({
            user: ownerId,
            type,
            idempotencyHash,
        }).lean();
        if (!replay) throw error;
        return { job: serializePrivacyJob(replay), replayed: true };
    }
};

const getPrivacyJob = async ({ userId, requestId }) => {
    requireEnabledPolicy();
    const job = await AccountPrivacyJob.findOne({
        _id: requestId,
        user: String(userId || '').trim(),
    }).lean();
    if (!job) throw new AppError('Privacy request not found', 404);
    return serializePrivacyJob(job);
};

const cancelPrivacyJob = async ({ userId, requestId, type }) => {
    requireEnabledPolicy();
    const job = await AccountPrivacyJob.findOneAndUpdate(
        {
            _id: requestId,
            user: String(userId || '').trim(),
            type,
            status: { $in: CANCELLABLE_STATUSES },
        },
        {
            $set: {
                status: 'cancelled',
                cancelledAt: new Date(),
                lockedAt: null,
                workerId: '',
            },
        },
        { returnDocument: 'after', lean: true }
    );
    if (!job) throw new AppError('Privacy request cannot be cancelled', 409);
    return serializePrivacyJob(job);
};

const getPublicPrivacyCapabilities = () => {
    const activation = getAccountPrivacyActivation();
    // A capability is only advertised when a handler that can actually finish
    // the job is wired. The policy contract being active is not enough.
    const serviceable = new Set(getRegisteredAccountPrivacyJobTypes());
    const isServiceable = (type) => activation.enabled && serviceable.has(type);

    return {
        contractVersion: 1,
        enabled: activation.enabled,
        policyApproved: activation.policyApproved,
        policyVersion: activation.policyVersion,
        blockedReason: activation.blockedReason,
        // Job types this deployment cannot service right now.
        unsupportedJobTypes: getUnserviceableAccountPrivacyJobTypes(),
        capabilities: {
            export: isServiceable('export'),
            deactivation: isServiceable('deactivation'),
            deletion: isServiceable('deletion'),
            // Cancellation is handled inline by the API and needs no worker.
            cancellation: activation.enabled,
        },
    };
};

module.exports = {
    CANCELLABLE_STATUSES,
    cancelPrivacyJob,
    createPrivacyJob,
    getPrivacyJob,
    getPublicPrivacyCapabilities,
    requireEnabledPolicy,
    serializePrivacyJob,
    __private: {
        buildIdempotencyHash,
    },
};

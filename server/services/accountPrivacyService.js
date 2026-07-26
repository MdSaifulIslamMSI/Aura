const crypto = require('crypto');
const AccountPrivacyJob = require('../models/AccountPrivacyJob');
const AppError = require('../utils/AppError');
const { getAccountPrivacyActivation } = require('../config/accountPrivacyFlags');

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

const createPrivacyJob = async ({ userId, type, idempotencyKey }) => {
    const activation = requireEnabledPolicy();
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
    return {
        contractVersion: 1,
        enabled: activation.enabled,
        policyApproved: activation.policyApproved,
        policyVersion: activation.policyVersion,
        blockedReason: activation.blockedReason,
        capabilities: {
            export: activation.enabled,
            deactivation: activation.enabled,
            deletion: activation.enabled,
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

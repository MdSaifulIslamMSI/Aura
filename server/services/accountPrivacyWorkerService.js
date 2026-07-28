const AccountPrivacyJob = require('../models/AccountPrivacyJob');
const { requireEnabledPolicy, serializePrivacyJob } = require('./accountPrivacyService');
const { recordAccountPrivacyJobState } = require('./accountProductTelemetryService');

const CLAIMABLE_TYPES = Object.freeze(['export', 'deactivation', 'deletion']);
const SAFE_HANDLER_STATUSES = new Set(['ready', 'completed', 'blocked']);

const claimNextPrivacyJob = async ({ workerId, now = new Date() }) => {
    requireEnabledPolicy();
    const normalizedWorkerId = String(workerId || '').trim();
    if (!normalizedWorkerId) throw new Error('Privacy worker identifier is required');

    return AccountPrivacyJob.findOneAndUpdate(
        {
            type: { $in: CLAIMABLE_TYPES },
            $or: [
                { status: 'queued' },
                { status: 'awaiting_grace', graceEndsAt: { $lte: now } },
                {
                    status: 'processing',
                    lockedAt: { $lt: new Date(now.getTime() - 15 * 60 * 1000) },
                },
            ],
        },
        {
            $set: {
                status: 'processing',
                workerId: normalizedWorkerId,
                lockedAt: now,
            },
            $inc: { attempts: 1 },
        },
        {
            sort: { createdAt: 1, _id: 1 },
            returnDocument: 'after',
            lean: true,
        }
    );
};

const completeClaimedPrivacyJob = async ({
    job,
    workerId,
    outcome,
    now = new Date(),
}) => {
    const nextStatus = SAFE_HANDLER_STATUSES.has(outcome?.status)
        ? outcome.status
        : 'failed';
    const update = {
        status: nextStatus,
        lockedAt: null,
        workerId: '',
        failureCode: nextStatus === 'failed'
            ? String(outcome?.failureCode || 'worker_handler_failed').slice(0, 120)
            : '',
    };
    if (['ready', 'completed'].includes(nextStatus)) update.completedAt = now;
    if (outcome?.exportExpiresAt instanceof Date) update.exportExpiresAt = outcome.exportExpiresAt;
    if (typeof outcome?.artifactKeyEncrypted === 'string') {
        update.artifactKeyEncrypted = outcome.artifactKeyEncrypted;
    }

    const updated = await AccountPrivacyJob.findOneAndUpdate(
        {
            _id: job._id,
            status: 'processing',
            workerId: String(workerId || '').trim(),
        },
        { $set: update },
        { returnDocument: 'after', lean: true }
    );
    return updated ? serializePrivacyJob(updated) : null;
};

const processNextPrivacyJob = async ({
    workerId,
    handlers = {},
    now = new Date(),
} = {}) => {
    const job = await claimNextPrivacyJob({ workerId, now });
    if (!job) return null;
    recordAccountPrivacyJobState({
        type: job.type,
        status: 'processing',
    });
    const handler = handlers[job.type];
    let outcome;
    try {
        outcome = typeof handler === 'function'
            ? await handler(job)
            : { status: 'failed', failureCode: 'handler_unavailable' };
    } catch {
        outcome = { status: 'failed', failureCode: 'handler_failed' };
    }
    const completed = await completeClaimedPrivacyJob({
        job,
        workerId,
        outcome,
        now: new Date(),
    });
    if (completed) {
        recordAccountPrivacyJobState({
            type: completed.type,
            status: completed.status,
        });
    }
    return completed;
};

module.exports = {
    CLAIMABLE_TYPES,
    claimNextPrivacyJob,
    completeClaimedPrivacyJob,
    processNextPrivacyJob,
};

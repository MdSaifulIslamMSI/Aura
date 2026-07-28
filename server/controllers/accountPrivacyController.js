const asyncHandler = require('express-async-handler');
const AppError = require('../utils/AppError');
const {
    cancelPrivacyJob,
    createPrivacyJob,
    getPrivacyJob,
    getPublicPrivacyCapabilities,
} = require('../services/accountPrivacyService');
const { recordAuthSecurityEvent } = require('../services/authSecurityTelemetryService');
const { recordAccountPrivacyJobState } = require('../services/accountProductTelemetryService');

const getOwnerId = (req) => String(req.user?._id || '').trim();
const getIdempotencyKey = (req) => String(req.get('Idempotency-Key') || '').trim();

const getPrivacyCapabilities = asyncHandler(async (_req, res) => {
    res.set('Cache-Control', 'private, no-store');
    return res.status(200).json(getPublicPrivacyCapabilities());
});

const createRequestController = (type) => asyncHandler(async (req, res, next) => {
    const userId = getOwnerId(req);
    if (!userId) return next(new AppError('Not authorized', 401));
    const result = await createPrivacyJob({
        userId,
        type,
        idempotencyKey: getIdempotencyKey(req),
    });
    recordAuthSecurityEvent({
        event: `account.privacy.${type}.requested`,
        outcome: result.replayed ? 'issued' : 'success',
        reason: result.replayed ? 'idempotent_replay' : 'user_requested',
        surface: 'account_privacy',
        req,
        meta: {
            requestType: type,
            status: result.job.status,
        },
    });
    recordAccountPrivacyJobState({
        type,
        status: result.job.status,
    });
    res.set('Cache-Control', 'private, no-store');
    return res.status(result.replayed ? 200 : 202).json({
        success: true,
        replayed: result.replayed,
        request: result.job,
    });
});

const getPrivacyRequest = asyncHandler(async (req, res, next) => {
    const userId = getOwnerId(req);
    if (!userId) return next(new AppError('Not authorized', 401));
    const job = await getPrivacyJob({
        userId,
        requestId: req.params.requestId,
    });
    res.set('Cache-Control', 'private, no-store');
    return res.status(200).json({ success: true, request: job });
});

const cancelRequestController = (type) => asyncHandler(async (req, res, next) => {
    const userId = getOwnerId(req);
    if (!userId) return next(new AppError('Not authorized', 401));
    const job = await cancelPrivacyJob({
        userId,
        requestId: req.params.requestId,
        type,
    });
    recordAuthSecurityEvent({
        event: `account.privacy.${type}.cancelled`,
        outcome: 'success',
        reason: 'user_requested',
        surface: 'account_privacy',
        req,
        meta: {
            requestType: type,
            status: job.status,
        },
    });
    recordAccountPrivacyJobState({
        type,
        status: job.status,
    });
    res.set('Cache-Control', 'private, no-store');
    return res.status(200).json({ success: true, request: job });
});

module.exports = {
    cancelDeactivationRequest: cancelRequestController('deactivation'),
    cancelDeletionRequest: cancelRequestController('deletion'),
    getPrivacyCapabilities,
    getPrivacyRequest,
    requestAccountDeactivation: createRequestController('deactivation'),
    requestAccountDeletion: createRequestController('deletion'),
    requestAccountExport: createRequestController('export'),
};

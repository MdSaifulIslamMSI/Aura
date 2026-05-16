const asyncHandler = require('express-async-handler');
const AppError = require('../utils/AppError');
const EmergencyAuditLog = require('../models/EmergencyAuditLog');
const {
    CRITICAL_CONFIRMATION_KEYS,
    DEFAULT_EMERGENCY_FLAGS,
    EMERGENCY_CONFIRMATION_PHRASE,
} = require('../config/emergencyControlConstants');
const {
    activateFlag,
    buildPublicStatus,
    deactivateFlag,
    extendFlag,
    getAllActiveFlags,
    getAllFlagsForAdmin,
    recordFailedAttempt,
    updateFlagMessage,
} = require('../services/emergencyControlService');

const stripInternalFlagFields = (flag = {}) => {
    const {
        internalReason,
        activatedByUserId,
        activatedByEmail,
        approvedByUserId,
        approvedByEmail,
        metadata,
        ...publicSafe
    } = flag || {};
    return publicSafe;
};

const requireCriticalControls = async (req, key, { action = 'ACTIVATE' } = {}) => {
    const defaults = DEFAULT_EMERGENCY_FLAGS[key] || {};
    const critical = defaults.severity === 'critical' || CRITICAL_CONFIRMATION_KEYS.has(key);
    if (!critical) return;

    if (!String(req.body?.reason || '').trim()) {
        await recordFailedAttempt({
            flagKey: key,
            reason: 'critical_reason_required',
            req,
            metadata: { action },
        });
        throw new AppError('Critical emergency actions require a reason', 400);
    }

    if (
        CRITICAL_CONFIRMATION_KEYS.has(key)
        && String(req.body?.confirmationPhrase || '').trim() !== EMERGENCY_CONFIRMATION_PHRASE
    ) {
        await recordFailedAttempt({
            flagKey: key,
            reason: 'critical_confirmation_phrase_required',
            req,
            metadata: { action },
        });
        throw new AppError(`Type ${EMERGENCY_CONFIRMATION_PHRASE} to confirm this critical emergency action`, 400);
    }
};

const getEmergencyStatus = asyncHandler(async (req, res) => {
    const status = await buildPublicStatus();
    res.set('Cache-Control', 'no-store');
    res.json(status);
});

const listEmergencyControls = asyncHandler(async (req, res) => {
    const [flags, activeFlags] = await Promise.all([
        getAllFlagsForAdmin(),
        getAllActiveFlags({ failOpen: true }),
    ]);
    res.set('Cache-Control', 'no-store');
    res.json({
        success: true,
        flags,
        activeFlags,
        requestId: req.requestId || '',
    });
});

const activateEmergencyControl = asyncHandler(async (req, res) => {
    const key = req.params.key;
    await requireCriticalControls(req, key, { action: 'ACTIVATE' });
    const flag = await activateFlag(key, {
        ...req.body,
        req,
    });
    res.status(200).json({
        success: true,
        flag,
        requestId: req.requestId || '',
    });
});

const deactivateEmergencyControl = asyncHandler(async (req, res) => {
    const key = req.params.key;
    await requireCriticalControls(req, key, { action: 'DEACTIVATE' });
    const flag = await deactivateFlag(key, {
        reason: req.body?.reason || '',
        req,
    });
    res.status(200).json({
        success: true,
        flag,
        requestId: req.requestId || '',
    });
});

const extendEmergencyControl = asyncHandler(async (req, res) => {
    const key = req.params.key;
    const flag = await extendFlag(key, {
        reason: req.body?.reason || '',
        expiresAt: req.body?.expiresAt,
        req,
    });
    res.status(200).json({
        success: true,
        flag,
        requestId: req.requestId || '',
    });
});

const updateEmergencyControlMessage = asyncHandler(async (req, res) => {
    const key = req.params.key;
    const flag = await updateFlagMessage(key, {
        reason: req.body?.reason || '',
        userMessage: req.body?.userMessage || '',
        req,
    });
    res.status(200).json({
        success: true,
        flag,
        requestId: req.requestId || '',
    });
});

const listEmergencyAuditLogs = asyncHandler(async (req, res) => {
    const query = {};
    if (req.query?.flagKey) query.flagKey = req.query.flagKey;
    const limit = Number(req.query?.limit || 50);
    const logs = await EmergencyAuditLog.find(query)
        .sort({ createdAt: -1 })
        .limit(Math.min(Math.max(limit, 1), 200))
        .lean();
    res.set('Cache-Control', 'no-store');
    res.json({
        success: true,
        logs,
        requestId: req.requestId || '',
    });
});

module.exports = {
    activateEmergencyControl,
    deactivateEmergencyControl,
    extendEmergencyControl,
    getEmergencyStatus,
    listEmergencyAuditLogs,
    listEmergencyControls,
    stripInternalFlagFields,
    updateEmergencyControlMessage,
};

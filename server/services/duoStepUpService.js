const AppError = require('../utils/AppError');
const { getDuoFlags } = require('../config/duoFlags');

const DUO_STEP_UP_ACTIONS = Object.freeze({
    ADMIN_SENSITIVE: 'admin-sensitive',
    RECOVERY_SENSITIVE: 'recovery-sensitive',
});

const normalizeText = (value) => String(value || '').trim().toLowerCase();

const getDuoStepUpReadiness = (env = process.env) => {
    const flags = getDuoFlags(env);
    return {
        ...flags,
        stepUpReady: Boolean(flags.enabled && flags.mode === 'oidc' && flags.configured),
    };
};

const hasFreshDuoStepUp = (authSession = {}) => {
    const amr = Array.isArray(authSession?.amr)
        ? authSession.amr.map((entry) => normalizeText(entry))
        : [];
    const stepUpUntilMs = authSession?.stepUpUntil
        ? new Date(authSession.stepUpUntil).getTime()
        : 0;

    return amr.some((entry) => entry === 'duo' || entry === 'duo_oidc')
        && Number.isFinite(stepUpUntilMs)
        && stepUpUntilMs > Date.now();
};

const buildDuoStepUpError = ({ statusCode = 403, message, code, action = '' } = {}) => {
    const error = new AppError(message, statusCode);
    error.code = code;
    error.feature = 'duo_step_up';
    error.duoAction = action;
    return error;
};

const assertDuoStepUpReady = ({ action = '', env = process.env } = {}) => {
    const readiness = getDuoStepUpReadiness(env);
    if (!readiness.enabled) {
        return readiness;
    }

    if (!readiness.stepUpReady) {
        throw buildDuoStepUpError({
            statusCode: 503,
            code: 'DUO_NOT_CONFIGURED',
            action,
            message: 'Duo step-up is enabled but not fully configured.',
        });
    }

    return readiness;
};

const requireDuoStepUp = (req = {}, { action = '' } = {}) => {
    const readiness = assertDuoStepUpReady({ action });
    if (!readiness.enabled) {
        return { required: false, satisfied: true };
    }

    if (!req.authSession?.sessionId) {
        throw buildDuoStepUpError({
            statusCode: 401,
            code: 'DUO_SESSION_REQUIRED',
            action,
            message: 'Duo step-up requires an active browser session.',
        });
    }

    if (!hasFreshDuoStepUp(req.authSession)) {
        throw buildDuoStepUpError({
            statusCode: 403,
            code: 'DUO_STEP_UP_REQUIRED',
            action,
            message: 'Duo step-up verification is required for this action.',
        });
    }

    return { required: true, satisfied: true };
};

const buildDuoStepUpState = ({ req = {}, action = '', returnTo = '/' } = {}) => ({
    stepUp: true,
    duoAction: normalizeText(action),
    sessionId: String(req.authSession?.sessionId || '').trim(),
    userId: String(req.user?._id || req.authSession?.userId || '').trim(),
    email: String(req.user?.email || req.authSession?.email || '').trim().toLowerCase(),
    returnTo,
});

module.exports = {
    DUO_STEP_UP_ACTIONS,
    assertDuoStepUpReady,
    buildDuoStepUpState,
    getDuoStepUpReadiness,
    hasFreshDuoStepUp,
    requireDuoStepUp,
};

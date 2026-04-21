const AppError = require('../utils/AppError');
const logger = require('../utils/logger');

const AUTH_ASSURANCE_ACTIONS = Object.freeze({
    AUTH_SYNC_ELEVATED_LOGIN: 'auth-sync:elevated-login',
    PASSWORD_RESET_FINALIZE: 'password-reset:finalize',
});

const AUTH_ASSURANCE_LEVELS = Object.freeze({
    NONE: 'none',
    PASSWORD: 'password',
    OTP: 'otp',
    TRUSTED_DEVICE: 'trusted-device',
    PASSKEY_STEP_UP: 'passkey-step-up',
});

const LEVEL_RANK = Object.freeze({
    [AUTH_ASSURANCE_LEVELS.NONE]: 0,
    [AUTH_ASSURANCE_LEVELS.PASSWORD]: 1,
    [AUTH_ASSURANCE_LEVELS.OTP]: 2,
    [AUTH_ASSURANCE_LEVELS.TRUSTED_DEVICE]: 3,
    [AUTH_ASSURANCE_LEVELS.PASSKEY_STEP_UP]: 4,
});

const normalizeText = (value) => String(value || '').trim().toLowerCase();

const rankAssuranceLevel = (level) => LEVEL_RANK[normalizeText(level)] || 0;

const isPasskeyMethod = (method = '') => normalizeText(method) === 'webauthn';

const hasMatchingDeviceSession = ({ flow = {}, trustedDeviceSignal = {}, deviceSessionHash = '' } = {}) => {
    const requiredHash = String(flow?.signalBond?.deviceSessionHash || '').trim();
    const requestHash = String(deviceSessionHash || '').trim();
    const signalHash = String(trustedDeviceSignal?.deviceSessionHash || '').trim();

    if (!requiredHash) return false;
    return requestHash === requiredHash || signalHash === requiredHash;
};

const hasFreshPasskeySignal = ({ flow = {}, trustedDeviceSignal = {} } = {}) => {
    if (trustedDeviceSignal?.verified && isPasskeyMethod(trustedDeviceSignal?.method)) {
        const requiredHash = String(flow?.signalBond?.deviceSessionHash || '').trim();
        return !requiredHash || String(trustedDeviceSignal.deviceSessionHash || '').trim() === requiredHash;
    }

    return false;
};

const hasPasskeyStepUp = ({ action = '', flow = {}, trustedDeviceSignal = {}, deviceSessionHash = '' } = {}) => {
    if (normalizeText(action) === AUTH_ASSURANCE_ACTIONS.PASSWORD_RESET_FINALIZE) {
        return hasFreshPasskeySignal({ flow, trustedDeviceSignal });
    }

    if (hasFreshPasskeySignal({ flow, trustedDeviceSignal })) {
        return true;
    }

    return isPasskeyMethod(flow?.signalBond?.deviceMethod)
        && hasMatchingDeviceSession({ flow, trustedDeviceSignal, deviceSessionHash });
};

const resolveGrantedLevel = ({
    action = '',
    flow = null,
    trustedDeviceSignal = {},
    deviceSessionHash = '',
    resetSessionFresh = false,
    firebaseAuthFresh = false,
} = {}) => {
    const normalizedAction = normalizeText(action);
    if (normalizedAction === AUTH_ASSURANCE_ACTIONS.PASSWORD_RESET_FINALIZE && !resetSessionFresh) {
        return AUTH_ASSURANCE_LEVELS.NONE;
    }
    if (normalizedAction === AUTH_ASSURANCE_ACTIONS.AUTH_SYNC_ELEVATED_LOGIN && !firebaseAuthFresh) {
        return AUTH_ASSURANCE_LEVELS.NONE;
    }

    if (hasPasskeyStepUp({ action, flow, trustedDeviceSignal, deviceSessionHash })) {
        return AUTH_ASSURANCE_LEVELS.PASSKEY_STEP_UP;
    }

    if (hasMatchingDeviceSession({ flow, trustedDeviceSignal, deviceSessionHash })) {
        return AUTH_ASSURANCE_LEVELS.TRUSTED_DEVICE;
    }

    if (flow?.factor || resetSessionFresh || firebaseAuthFresh) {
        return AUTH_ASSURANCE_LEVELS.OTP;
    }

    return AUTH_ASSURANCE_LEVELS.NONE;
};

const resolveRequiredLevel = ({ action = '', flow = {}, trustedDeviceSignal = {} } = {}) => {
    const normalizedAction = normalizeText(action);
    const flowMethod = normalizeText(flow?.signalBond?.deviceMethod);
    const signalMethod = normalizeText(trustedDeviceSignal?.method);
    const isPasskeyBound = flowMethod === 'webauthn' || signalMethod === 'webauthn';

    if (normalizedAction === AUTH_ASSURANCE_ACTIONS.PASSWORD_RESET_FINALIZE && isPasskeyBound) {
        return AUTH_ASSURANCE_LEVELS.PASSKEY_STEP_UP;
    }

    if (normalizedAction === AUTH_ASSURANCE_ACTIONS.AUTH_SYNC_ELEVATED_LOGIN && isPasskeyBound) {
        return AUTH_ASSURANCE_LEVELS.PASSKEY_STEP_UP;
    }

    if (flow?.signalBond?.deviceSessionHash) {
        return AUTH_ASSURANCE_LEVELS.TRUSTED_DEVICE;
    }

    return AUTH_ASSURANCE_LEVELS.OTP;
};

const buildFailureMessage = ({ action = '', requiredLevel = '', grantedLevel = '' } = {}) => {
    if (normalizeText(action) === AUTH_ASSURANCE_ACTIONS.PASSWORD_RESET_FINALIZE
        && grantedLevel === AUTH_ASSURANCE_LEVELS.NONE) {
        return 'Fresh recovery OTP verification is required for this auth step.';
    }
    if (normalizeText(action) === AUTH_ASSURANCE_ACTIONS.AUTH_SYNC_ELEVATED_LOGIN
        && grantedLevel === AUTH_ASSURANCE_LEVELS.NONE) {
        return 'Fresh login is required before secure access can be granted.';
    }
    if (requiredLevel === AUTH_ASSURANCE_LEVELS.PASSKEY_STEP_UP) {
        return 'Fresh passkey verification is required for this auth step.';
    }
    if (requiredLevel === AUTH_ASSURANCE_LEVELS.TRUSTED_DEVICE) {
        return 'Trusted device verification is required for this auth step.';
    }
    return grantedLevel === AUTH_ASSURANCE_LEVELS.NONE
        ? 'OTP verification is required for this auth step.'
        : 'Additional auth assurance is required for this auth step.';
};

const evaluateAuthAssurance = ({
    action = '',
    user = null,
    flow = null,
    trustedDeviceSignal = {},
    deviceSessionHash = '',
    resetSessionFresh = false,
    firebaseAuthFresh = false,
} = {}) => {
    const requiredLevel = resolveRequiredLevel({ action, flow, trustedDeviceSignal });
    const grantedLevel = resolveGrantedLevel({
        action,
        flow,
        trustedDeviceSignal,
        deviceSessionHash,
        resetSessionFresh,
        firebaseAuthFresh,
    });
    const allowed = rankAssuranceLevel(grantedLevel) >= rankAssuranceLevel(requiredLevel);
    const reasons = [];

    if (!allowed) {
        reasons.push(buildFailureMessage({ action, requiredLevel, grantedLevel }));
    }

    return {
        allowed,
        action: normalizeText(action),
        userId: String(user?._id || flow?.sub || ''),
        requiredLevel,
        grantedLevel,
        reasons,
        evidence: {
            flowPurpose: String(flow?.purpose || ''),
            flowFactor: String(flow?.factor || ''),
            nextStep: String(flow?.nextStep || ''),
            deviceBound: Boolean(flow?.signalBond?.deviceId),
            deviceSessionBound: Boolean(flow?.signalBond?.deviceSessionHash),
            deviceMethod: normalizeText(flow?.signalBond?.deviceMethod || trustedDeviceSignal?.method),
            passkeyStepUp: hasPasskeyStepUp({ action, flow, trustedDeviceSignal, deviceSessionHash }),
            resetSessionFresh: Boolean(resetSessionFresh),
            firebaseAuthFresh: Boolean(firebaseAuthFresh),
        },
    };
};

const logAssuranceDecision = (decision) => {
    const payload = {
        action: decision.action,
        userId: decision.userId,
        requiredLevel: decision.requiredLevel,
        grantedLevel: decision.grantedLevel,
        allowed: decision.allowed,
        reasons: decision.reasons,
        evidence: decision.evidence,
    };

    if (decision.allowed) {
        logger.info('auth.assurance_policy_allowed', payload);
    } else {
        logger.warn('auth.assurance_policy_denied', payload);
    }
};

const requireAuthAssurance = (options = {}) => {
    const decision = evaluateAuthAssurance(options);
    logAssuranceDecision(decision);

    if (!decision.allowed) {
        throw new AppError(decision.reasons[0] || 'Additional auth assurance is required for this auth step.', 403);
    }

    return decision;
};

module.exports = {
    AUTH_ASSURANCE_ACTIONS,
    AUTH_ASSURANCE_LEVELS,
    evaluateAuthAssurance,
    rankAssuranceLevel,
    requireAuthAssurance,
};

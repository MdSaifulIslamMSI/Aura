const AppError = require('../utils/AppError');
const { resolveAlienOtpConfig } = require('../config/alienOtpConfig');
const {
    ALIEN_AUDIT_EVENTS,
    writeAlienAuditEvent,
} = require('../services/alienOtpAuditService');
const {
    consumeChallenge,
    verifyChallengeShape,
} = require('../services/alienOtpChallengeService');
const { verifyAlienAssertion } = require('../services/alienOtpWebAuthnService');
const { verifyDeviceBinding } = require('../services/alienDeviceBindingService');
const { evaluateAlienRisk } = require('../services/alienOtpRiskEngine');
const { normalizeAction } = require('../security/authShield/types');

const HEADER_CHALLENGE_ID = 'x-alien-otp-challenge-id';
const HEADER_ACTION = 'x-alien-otp-action';
const HEADER_RESOURCE = 'x-alien-otp-resource';
const HEADER_PROOF = 'x-alien-otp-proof';

const normalizeText = (value = '') => String(value || '').trim();

const resolveUserId = (req = {}) => normalizeText(req.user?._id || req.user?.id || req.authSession?.userId || req.authUid);
const resolveTenantId = (req = {}, resource = {}) => normalizeText(resource?.tenantId || req.user?.tenantId || req.user?.storeId || req.user?.sellerId);
const resolveSessionId = (req = {}) => normalizeText(req.authSession?.sessionId || req.headers?.['x-aura-session-id']);
const resolveDeviceId = (req = {}) => normalizeText(req.headers?.['x-aura-device-id'] || req.authSession?.deviceId);

const resolveResource = async (req = {}, resourceResolver) => {
    if (typeof resourceResolver !== 'function') return null;
    return resourceResolver(req);
};

const parseProof = (req = {}) => {
    const bodyProof = req.body?.alienOtpProof || req.body?.alienProof || null;
    if (bodyProof && typeof bodyProof === 'object') return bodyProof;

    const raw = normalizeText(req.headers?.[HEADER_PROOF] || req.get?.('X-Alien-OTP-Proof'));
    if (!raw) return null;
    try {
        return JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
    } catch {
        try {
            return JSON.parse(raw);
        } catch {
            return { raw };
        }
    }
};

const audit = (event, input = {}) => writeAlienAuditEvent({
    event,
    ...input,
}).catch(() => ({ auditId: '', event: null }));

const buildDecisionError = (message, reasons = []) => {
    const error = new AppError(message, 403);
    error.code = 'ALIEN_OTP_REQUIRED';
    error.reasons = reasons;
    return error;
};

const shouldRunForAction = (config, action, options = {}) => {
    if (!config.enabled) return false;
    if (options.surface === 'login') return config.loginEnabled;
    if (options.enabled === true) return true;
    return config.sensitiveActionsEnabled;
};

const alienOtpRequired = ({
    action = '',
    resourceResolver = null,
    riskLevel = 'medium',
    strict = false,
    surface = 'sensitive_action',
    enabled = false,
} = {}) => async (req, _res, next) => {
    const config = resolveAlienOtpConfig();
    const canonicalAction = normalizeAction(action || req.body?.action || req.headers?.[HEADER_ACTION]);
    const strictMode = Boolean(config.strictMode || strict);

    if (!shouldRunForAction(config, canonicalAction, { surface, enabled })) {
        return next();
    }

    let resource = null;
    try {
        resource = await resolveResource(req, resourceResolver);
    } catch {
        resource = null;
    }

    const userId = resolveUserId(req);
    const tenantId = resolveTenantId(req, resource);
    const sessionId = resolveSessionId(req);
    const deviceId = resolveDeviceId(req);
    const resourceId = normalizeText(
        req.headers?.[HEADER_RESOURCE]
        || req.body?.resourceId
        || resource?.id
        || resource?._id
        || ''
    );
    const challengeId = normalizeText(req.headers?.[HEADER_CHALLENGE_ID] || req.body?.alienOtpChallengeId);
    const proof = parseProof(req);
    const risk = config.riskEngineEnabled
        ? evaluateAlienRisk({
            user: req.user || {},
            session: { sessionId, authAgeSeconds: req.authShieldDecision?.authAgeSeconds },
            device: { deviceId },
            action: canonicalAction,
            resource,
            request: req,
        })
        : { riskLevel, reasons: [], requiresAlienProof: true, block: false };
    const auditBase = {
        req,
        userId,
        deviceId,
        tenantId,
        action: canonicalAction,
        resourceId,
        riskLevel: risk.riskLevel || riskLevel,
        challengeId,
        config,
    };

    if (risk.block && strictMode) {
        await audit(ALIEN_AUDIT_EVENTS.RISK_CRITICAL, {
            ...auditBase,
            decision: 'deny',
            reasons: risk.reasons,
        });
        return next(buildDecisionError('ALIEN OTP blocked this high-risk action.', risk.reasons));
    }

    if (!challengeId || !proof) {
        await audit(ALIEN_AUDIT_EVENTS.FALLBACK_USED, {
            ...auditBase,
            decision: strictMode ? 'deny_missing_proof' : 'allow_missing_proof_shadow',
            reasons: ['alien_proof_missing'],
        });
        if (strictMode) {
            return next(buildDecisionError('ALIEN OTP proof is required.', ['alien_proof_missing']));
        }
        return next();
    }

    const shape = await verifyChallengeShape({
        challengeId,
        userId,
        tenantId,
        action: canonicalAction,
        resourceId,
        sessionId,
        deviceId,
        requireDevice: config.deviceBoundEnabled,
    });
    if (!shape.ok) {
        const replayed = shape.reasons.includes('challenge_replayed');
        await audit(replayed ? ALIEN_AUDIT_EVENTS.CHALLENGE_REPLAYED : ALIEN_AUDIT_EVENTS.CHALLENGE_FAILED, {
            ...auditBase,
            decision: strictMode ? 'deny_invalid_challenge' : 'allow_invalid_challenge_shadow',
            reasons: shape.reasons,
        });
        if (strictMode) {
            return next(buildDecisionError('ALIEN OTP challenge is invalid.', shape.reasons));
        }
        return next();
    }

    const assertion = await verifyAlienAssertion({
        userId,
        challengeId,
        assertionResponse: proof,
        req,
        user: req.user,
    });
    const deviceBinding = config.deviceBoundEnabled
        ? verifyDeviceBinding({
            user: req.user,
            userId,
            sessionId,
            proof,
            request: req,
            authUid: req.authUid,
            authToken: req.authToken,
        })
        : { success: true };

    if (!assertion.success || !deviceBinding.success) {
        const reasons = [
            assertion.success ? '' : assertion.reason,
            deviceBinding.success ? '' : deviceBinding.reason,
        ].filter(Boolean);
        await audit(deviceBinding.success ? ALIEN_AUDIT_EVENTS.CHALLENGE_FAILED : ALIEN_AUDIT_EVENTS.DEVICE_REJECTED, {
            ...auditBase,
            decision: strictMode ? 'deny_invalid_proof' : 'allow_invalid_proof_shadow',
            reasons,
        });
        if (strictMode) {
            return next(buildDecisionError('ALIEN OTP proof verification failed.', reasons));
        }
        return next();
    }

    const consumed = await consumeChallenge(challengeId);
    if (!consumed.success) {
        await audit(consumed.reason === 'challenge_replayed' ? ALIEN_AUDIT_EVENTS.CHALLENGE_REPLAYED : ALIEN_AUDIT_EVENTS.CHALLENGE_FAILED, {
            ...auditBase,
            decision: strictMode ? 'deny_consume_failed' : 'allow_consume_failed_shadow',
            reasons: [consumed.reason],
        });
        if (strictMode) {
            return next(buildDecisionError('ALIEN OTP challenge was already used or expired.', [consumed.reason]));
        }
        return next();
    }

    req.alienOtpDecision = {
        decision: 'allow',
        action: canonicalAction,
        challengeId,
        riskLevel: risk.riskLevel || riskLevel,
        deviceId: assertion.deviceId || deviceId,
        reasons: risk.reasons || [],
    };

    await audit(ALIEN_AUDIT_EVENTS.CHALLENGE_CONSUMED, {
        ...auditBase,
        decision: 'allow',
        reasons: risk.reasons,
    });
    await audit(ALIEN_AUDIT_EVENTS.AUTHZ_ALLOWED, {
        ...auditBase,
        decision: 'allow',
        reasons: risk.reasons,
    });

    return next();
};

module.exports = {
    HEADER_ACTION,
    HEADER_CHALLENGE_ID,
    HEADER_PROOF,
    HEADER_RESOURCE,
    alienOtpRequired,
};

const asyncHandler = require('express-async-handler');
const AppError = require('../utils/AppError');
const { resolveAlienOtpConfig } = require('../config/alienOtpConfig');
const { createChallenge } = require('../services/alienOtpChallengeService');
const { generateAlienAssertionOptions } = require('../services/alienOtpWebAuthnService');
const { evaluateAlienRisk } = require('../services/alienOtpRiskEngine');
const {
    ALIEN_AUDIT_EVENTS,
    writeAlienAuditEvent,
} = require('../services/alienOtpAuditService');
const { normalizeAction } = require('../security/authShield/types');

const normalizeText = (value = '') => String(value || '').trim();

const resolveUserId = (req = {}) => normalizeText(req.user?._id || req.user?.id || req.authSession?.userId || req.authUid);
const resolveTenantId = (req = {}) => normalizeText(req.user?.tenantId || req.user?.storeId || req.user?.sellerId);
const resolveSessionId = (req = {}) => normalizeText(req.authSession?.sessionId || req.headers?.['x-aura-session-id']);
const resolveDeviceId = (req = {}) => normalizeText(req.headers?.['x-aura-device-id'] || req.authSession?.deviceId || req.body?.deviceId);

const createAlienOtpChallenge = asyncHandler(async (req, res) => {
    const config = resolveAlienOtpConfig();
    if (!config.enabled || !config.sensitiveActionsEnabled) {
        throw new AppError('ALIEN OTP challenge issuance is disabled.', 403);
    }

    const userId = resolveUserId(req);
    const action = normalizeAction(req.body?.action);
    const resourceId = normalizeText(req.body?.resourceId);
    const tenantId = resolveTenantId(req);
    const sessionId = resolveSessionId(req);
    const deviceId = resolveDeviceId(req);

    if (!userId) throw new AppError('Authenticated user is required for ALIEN OTP.', 401);
    if (!action) throw new AppError('ALIEN OTP action is required.', 400);
    if (config.deviceBoundEnabled && !deviceId) {
        throw new AppError('Device identity is required for ALIEN OTP.', 400);
    }

    const risk = config.riskEngineEnabled
        ? evaluateAlienRisk({
            user: req.user || {},
            session: { sessionId },
            device: { deviceId },
            action,
            resource: { id: resourceId, tenantId },
            request: req,
        })
        : { riskLevel: 'medium', reasons: [], requiresAlienProof: true };
    const challenge = await createChallenge({
        userId,
        tenantId,
        action,
        resourceId,
        sessionId,
        deviceId,
        requestId: req.requestId || req.headers?.['x-request-id'] || '',
        riskContext: risk,
    });
    const webauthnOptions = await generateAlienAssertionOptions({
        userId,
        challengeId: challenge.challengeId,
        req,
        user: req.user,
    });

    await writeAlienAuditEvent({
        event: ALIEN_AUDIT_EVENTS.CHALLENGE_CREATED,
        req,
        userId,
        deviceId,
        tenantId,
        action,
        resourceId,
        riskLevel: challenge.riskLevel,
        decision: 'created',
        reasons: risk.reasons,
        challengeId: challenge.challengeId,
        config,
    });

    res.status(201).json({
        success: true,
        challengeId: challenge.challengeId,
        publicChallenge: challenge.nonce,
        expiresAt: challenge.expiresAt,
        riskLevel: challenge.riskLevel,
        webauthnOptions,
        fallback: webauthnOptions ? null : 'existing_mfa_step_up',
    });
});

module.exports = {
    createAlienOtpChallenge,
};

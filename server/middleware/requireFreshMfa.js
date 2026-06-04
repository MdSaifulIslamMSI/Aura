const AppError = require('../utils/AppError');
const {
    buildPublicMfaPolicy,
    evaluateAction,
} = require('../services/mfaPolicyService');
const { createMfaChallenge } = require('../services/mfaChallengeService');
const { recordAuthSecurityEvent } = require('../services/authSecurityTelemetryService');

const normalizeText = (value) => String(value || '').trim();

const buildStepUpError = ({ challenge, policy } = {}) => {
    const error = new AppError('Fresh MFA verification is required for this action.', 403);
    error.code = 'FRESH_MFA_REQUIRED';
    error.requiresStepUpMfa = true;
    error.mfaChallenge = challenge;
    error.mfaPolicy = buildPublicMfaPolicy(policy);
    return error;
};

const enforceFreshMfa = async (req, _res, next, options = {}) => {
    const policy = evaluateAction({
        user: req.user,
        session: req.authSession || null,
        action: normalizeText(options.action),
        route: normalizeText(req.originalUrl || req.url),
        category: normalizeText(options.category),
    });

    if (!policy.freshMfaRequired || policy.satisfied) {
        return next();
    }

    if (policy.block) {
        recordAuthSecurityEvent({
            event: 'mfa.policy.blocked',
            outcome: 'failure',
            reason: policy.reason || 'blocked',
            surface: 'mfa',
            req,
            meta: { action: policy.action || '', statusCode: 403 },
        });
        const error = new AppError('Fresh MFA is required but no allowed verification method is available.', 403);
        error.code = 'MFA_METHOD_REQUIRED';
        error.requiresStepUpMfa = true;
        error.mfaPolicy = buildPublicMfaPolicy(policy);
        return next(error);
    }

    const challenge = await createMfaChallenge({
        user: req.user,
        purpose: 'step_up',
        policy,
        req,
        action: policy.action || normalizeText(options.action),
    });

    recordAuthSecurityEvent({
        event: 'mfa.step_up.required',
        outcome: 'required',
        reason: policy.reason || 'required',
        surface: 'mfa',
        req,
        meta: { action: policy.action || '' },
    });

    return next(buildStepUpError({ challenge, policy }));
};

const requireFreshMfa = (options = {}) => (req, res, next) => {
    Promise.resolve(enforceFreshMfa(req, res, next, options)).catch(next);
};

module.exports = {
    buildStepUpError,
    enforceFreshMfa,
    requireFreshMfa,
};

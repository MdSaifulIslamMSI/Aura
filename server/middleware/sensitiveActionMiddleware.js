const AppError = require('../utils/AppError');
const {
    evaluateSensitiveActionRequest,
} = require('../security/sensitiveActionPolicy');
const {
    recordSensitiveActionDecision,
} = require('../services/securityAuditService');

const PUBLIC_ERROR_BY_REASON = Object.freeze({
    sensitive_action_authentication_required: ['Authentication required for this action.', 401],
    admin_assurance_required: ['Additional admin assurance is required.', 403],
    webauthn_recent_auth_required: ['Recent re-authentication is required for this action.', 401],
    webauthn_registration_required: ['WebAuthn registration is required for this admin action.', 403],
    webauthn_step_up_required: ['Fresh WebAuthn step-up verification is required for this action.', 403],
    break_glass_required: ['Break-glass approval is required for this action.', 403],
});

const buildSensitiveActionError = (decision = {}) => {
    const [message, statusCode] = PUBLIC_ERROR_BY_REASON[decision.reason]
        || ['Sensitive action policy denied this request.', 403];
    const error = new AppError(message, statusCode);
    error.code = String(decision.reason || 'sensitive_action_denied').toUpperCase();
    error.telemetryCode = decision.telemetryCode;
    return error;
};

const requireSensitiveAction = (options = {}) => (req, _res, next) => {
    const decision = evaluateSensitiveActionRequest(req, options);
    req.sensitiveActionDecision = decision;
    recordSensitiveActionDecision({ req, decision, meta: options.auditMeta || {} });

    if (!decision.allowed) {
        return next(buildSensitiveActionError(decision));
    }

    return next();
};

module.exports = {
    buildSensitiveActionError,
    requireSensitiveAction,
};

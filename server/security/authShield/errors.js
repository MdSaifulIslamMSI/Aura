const AppError = require('../../utils/AppError');

const CODE_BY_DECISION = Object.freeze({
    deny: 'AUTH_SHIELD_DENIED',
    step_up_required: 'STEP_UP_REQUIRED',
    shadow_deny: 'AUTH_SHIELD_SHADOW_DENY',
});

const MESSAGE_BY_DECISION = Object.freeze({
    deny: 'Action is not allowed.',
    step_up_required: 'Action requires additional verification.',
    shadow_deny: 'Action would require additional verification.',
});

const buildAuthShieldError = (decision = {}) => {
    const code = CODE_BY_DECISION[decision.decision] || 'AUTH_SHIELD_DENIED';
    const message = MESSAGE_BY_DECISION[decision.decision] || 'Action is not allowed.';
    const error = new AppError(message, decision.decision === 'step_up_required' ? 403 : 403);
    error.code = code;
    error.authShieldDecision = decision;
    return error;
};

const toSafeErrorBody = (decision = {}) => ({
    error: MESSAGE_BY_DECISION[decision.decision] || 'Action is not allowed.',
    code: CODE_BY_DECISION[decision.decision] || 'AUTH_SHIELD_DENIED',
    requestId: decision.requestId || '',
});

module.exports = {
    buildAuthShieldError,
    toSafeErrorBody,
};

const AppError = require('../utils/AppError');

const buildTrustError = (decision = {}) => {
    const statusCode = decision.decision === 'THROTTLE'
        ? 429
        : decision.decision === 'CHALLENGE'
            ? 428
            : 403;
    const message = decision.decision === 'CHALLENGE'
        ? 'Step-up verification is required for this action.'
        : decision.decision === 'THROTTLE'
            ? 'Request was throttled by Trust Fabric.'
            : 'Access denied by Trust Fabric.';
    const error = new AppError(message, statusCode);
    error.code = decision.decision === 'CHALLENGE'
        ? 'STEP_UP_REQUIRED'
        : decision.decision === 'THROTTLE'
            ? 'TRUST_THROTTLED'
            : 'ACCESS_DENIED';
    error.reason = decision.reason;
    error.decisionId = decision.evidence?.decisionId || '';
    error.requiredStepUp = decision.requiredStepUp || null;
    return error;
};

module.exports = {
    buildTrustError,
};

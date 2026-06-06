const {
    SENSITIVITY_LEVELS,
    SENSITIVITY_ORDER,
    normalizeSensitivity,
    sensitivityAtLeast,
} = require('./securityDecisionTypes');
const {
    getSensitiveActionPolicy,
    looksSensitiveAction,
} = require('./sensitiveActionRegistry');

const DEFAULT_MAX_RISK_BY_SENSITIVITY = Object.freeze({
    [SENSITIVITY_LEVELS.LOW]: 90,
    [SENSITIVITY_LEVELS.MEDIUM]: 75,
    [SENSITIVITY_LEVELS.HIGH]: 60,
    [SENSITIVITY_LEVELS.CRITICAL]: 45,
});

const getSensitivityRank = (sensitivity = SENSITIVITY_LEVELS.LOW) => (
    SENSITIVITY_ORDER[normalizeSensitivity(sensitivity)] || SENSITIVITY_ORDER.low
);

const isSensitive = (sensitivity) => sensitivityAtLeast(sensitivity, SENSITIVITY_LEVELS.MEDIUM);

const isHighSensitivity = (sensitivity) => sensitivityAtLeast(sensitivity, SENSITIVITY_LEVELS.HIGH);

const resolveActionPolicy = (action = '', overrides = {}) => {
    const registered = getSensitiveActionPolicy(action);
    if (registered) {
        return {
            ...registered,
            ...overrides,
            sensitivity: normalizeSensitivity(overrides.sensitivity || registered.sensitivity),
            maxRiskAllowed: Number.isFinite(Number(overrides.maxRiskAllowed))
                ? Number(overrides.maxRiskAllowed)
                : registered.maxRiskAllowed,
            unknownSensitiveAction: false,
        };
    }

    const sensitivity = normalizeSensitivity(overrides.sensitivity || SENSITIVITY_LEVELS.LOW);
    const unknownSensitiveAction = Boolean(overrides.unknownSensitiveAction || looksSensitiveAction(action));
    return {
        action,
        sensitivity,
        requiresAuth: Boolean(overrides.requiresAuth),
        requiresFreshAuth: Boolean(overrides.requiresFreshAuth),
        requiresMfa: Boolean(overrides.requiresMfa),
        requiresPasskeyForAdmin: Boolean(overrides.requiresPasskeyForAdmin),
        requiresTenantBoundary: Boolean(overrides.requiresTenantBoundary),
        requiresOwnerCheck: Boolean(overrides.requiresOwnerCheck),
        requiresAudit: Boolean(overrides.requiresAudit || unknownSensitiveAction),
        rateLimitPolicy: overrides.rateLimitPolicy || null,
        maxRiskAllowed: Number.isFinite(Number(overrides.maxRiskAllowed))
            ? Number(overrides.maxRiskAllowed)
            : DEFAULT_MAX_RISK_BY_SENSITIVITY[sensitivity],
        containmentPolicy: overrides.containmentPolicy || [],
        allowedRoles: overrides.allowedRoles || [],
        unknownSensitiveAction,
    };
};

module.exports = {
    DEFAULT_MAX_RISK_BY_SENSITIVITY,
    getSensitivityRank,
    isHighSensitivity,
    isSensitive,
    resolveActionPolicy,
};

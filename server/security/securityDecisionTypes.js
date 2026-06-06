const SECURITY_DECISIONS = Object.freeze({
    ALLOW: 'ALLOW',
    ALLOW_WITH_AUDIT: 'ALLOW_WITH_AUDIT',
    CHALLENGE: 'CHALLENGE',
    THROTTLE: 'THROTTLE',
    DENY: 'DENY',
    CONTAIN: 'CONTAIN',
});

const SENSITIVITY_LEVELS = Object.freeze({
    LOW: 'low',
    MEDIUM: 'medium',
    HIGH: 'high',
    CRITICAL: 'critical',
});

const SENSITIVITY_ORDER = Object.freeze({
    [SENSITIVITY_LEVELS.LOW]: 1,
    [SENSITIVITY_LEVELS.MEDIUM]: 2,
    [SENSITIVITY_LEVELS.HIGH]: 3,
    [SENSITIVITY_LEVELS.CRITICAL]: 4,
});

const RISK_LEVELS = Object.freeze({
    LOW: 'low',
    MEDIUM: 'medium',
    HIGH: 'high',
    CRITICAL: 'critical',
});

const normalizeDecision = (value = SECURITY_DECISIONS.DENY) => {
    const normalized = String(value || '').trim().toUpperCase();
    return SECURITY_DECISIONS[normalized] || SECURITY_DECISIONS.DENY;
};

const normalizeSensitivity = (value = SENSITIVITY_LEVELS.LOW) => {
    const normalized = String(value || '').trim().toLowerCase();
    return SENSITIVITY_ORDER[normalized] ? normalized : SENSITIVITY_LEVELS.LOW;
};

const sensitivityAtLeast = (actual, expected) => (
    SENSITIVITY_ORDER[normalizeSensitivity(actual)] >= SENSITIVITY_ORDER[normalizeSensitivity(expected)]
);

const normalizeAction = (value = '') => String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9*_.:-]/g, '');

module.exports = {
    RISK_LEVELS,
    SECURITY_DECISIONS,
    SENSITIVITY_LEVELS,
    SENSITIVITY_ORDER,
    normalizeAction,
    normalizeDecision,
    normalizeSensitivity,
    sensitivityAtLeast,
};

const DECISIONS = Object.freeze({
    ALLOW: 'allow',
    DENY: 'deny',
    STEP_UP_REQUIRED: 'step_up_required',
    SHADOW_DENY: 'shadow_deny',
});

const RISK_LEVELS = Object.freeze({
    LOW: 'low',
    MEDIUM: 'medium',
    HIGH: 'high',
    CRITICAL: 'critical',
});

const SENSITIVITIES = Object.freeze({
    LOW: 'low',
    MEDIUM: 'medium',
    HIGH: 'high',
    CRITICAL: 'critical',
});

const SENSITIVITY_ORDER = Object.freeze({
    [SENSITIVITIES.LOW]: 1,
    [SENSITIVITIES.MEDIUM]: 2,
    [SENSITIVITIES.HIGH]: 3,
    [SENSITIVITIES.CRITICAL]: 4,
});

const normalizeText = (value = '') => String(value || '').trim().toLowerCase();

const normalizeAction = (value = '') => normalizeText(value).replace(/[^a-z0-9*_.:-]/g, '');

const normalizeSensitivity = (value = SENSITIVITIES.MEDIUM) => {
    const normalized = normalizeText(value);
    return SENSITIVITY_ORDER[normalized] ? normalized : SENSITIVITIES.MEDIUM;
};

const sensitivityAtLeast = (actual, expected) => (
    SENSITIVITY_ORDER[normalizeSensitivity(actual)] >= SENSITIVITY_ORDER[normalizeSensitivity(expected)]
);

const isSensitive = (sensitivity) => sensitivityAtLeast(sensitivity, SENSITIVITIES.MEDIUM);

const isHighOrCritical = (sensitivity) => sensitivityAtLeast(sensitivity, SENSITIVITIES.HIGH);

const isCritical = (sensitivity) => normalizeSensitivity(sensitivity) === SENSITIVITIES.CRITICAL;

const actionFamily = (action = '') => {
    const parts = normalizeAction(action).split('.').filter(Boolean);
    if (parts.length <= 1) return parts[0] || 'unknown';
    return parts.slice(0, 2).join('.');
};

module.exports = {
    DECISIONS,
    RISK_LEVELS,
    SENSITIVITIES,
    actionFamily,
    isCritical,
    isHighOrCritical,
    isSensitive,
    normalizeAction,
    normalizeSensitivity,
    normalizeText,
    sensitivityAtLeast,
};

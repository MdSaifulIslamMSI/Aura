const {
    isCritical,
    normalizeAction,
    normalizeSensitivity,
    SENSITIVITIES,
} = require('./types');

const sensitiveActions = Object.freeze({
    'admin.user.role.update': {
        sensitivity: 'critical',
        stepUp: true,
        failClosed: true,
        requireTenant: true,
        requireAudit: true,
    },
    'admin.user.state.update': {
        sensitivity: 'critical',
        stepUp: true,
        failClosed: true,
        requireAudit: true,
    },
    'admin.config.update': {
        sensitivity: 'critical',
        stepUp: true,
        failClosed: true,
        requireAudit: true,
    },
    'payment.refund': {
        sensitivity: 'critical',
        stepUp: true,
        failClosed: true,
        requireDeviceProof: true,
        requireAudit: true,
    },
    'payment.payout.update': {
        sensitivity: 'critical',
        stepUp: true,
        failClosed: true,
        requireDeviceProof: true,
        requireAudit: true,
    },
    'auth.password.change': {
        sensitivity: 'high',
        stepUp: true,
        failClosed: true,
        requireAudit: true,
    },
    'auth.mfa.disable': {
        sensitivity: 'critical',
        stepUp: true,
        failClosed: true,
        requireAudit: true,
    },
    'auth.email.change': {
        sensitivity: 'high',
        stepUp: true,
        failClosed: true,
        requireAudit: true,
    },
    'order.cancel': {
        sensitivity: 'medium',
        stepUp: false,
        failClosed: false,
        requireTenant: true,
    },
    'listing.update': {
        sensitivity: 'medium',
        stepUp: false,
        failClosed: false,
        requireTenant: true,
    },
    'listing.delete': {
        sensitivity: 'medium',
        stepUp: false,
        failClosed: false,
        requireTenant: true,
    },
    'review.delete': {
        sensitivity: 'medium',
        stepUp: false,
        failClosed: false,
        requireTenant: true,
    },
    'upload.moderate': {
        sensitivity: 'high',
        stepUp: true,
        failClosed: true,
        requireAudit: true,
    },
});

const ACTION_ALIASES = Object.freeze({
    'admin.users.mutate': 'admin.user.state.update',
    'admin.security_config.change': 'admin.config.update',
    'payment.refund.create': 'payment.refund',
    'payment.payout.change': 'payment.payout.update',
    'payment.method.change': 'payment.payout.update',
    'auth.factor.change': 'auth.mfa.disable',
    'auth.recovery.change': 'auth.password.change',
    'order.status.change': 'order.cancel',
    'listing.write': 'listing.update',
    'listing.escrow.change': 'payment.payout.update',
    'upload.write': 'upload.moderate',
    'moderation.action': 'review.delete',
});

const wildcardPatterns = Object.freeze([
    'admin.*',
    'payment.*',
    'auth.mfa.*',
    'auth.password.*',
    'auth.email.*',
    'auth.role.*',
    'security.*',
]);

const wildcardMatches = (action = '', pattern = '') => {
    const normalizedAction = normalizeAction(action);
    const normalizedPattern = normalizeAction(pattern);
    if (!normalizedAction || !normalizedPattern) return false;
    if (normalizedPattern === '*') return true;
    if (!normalizedPattern.includes('*')) return normalizedAction === normalizedPattern;
    const prefix = normalizedPattern.split('*')[0];
    return normalizedAction.startsWith(prefix);
};

const matchesAnyPattern = (action = '', patterns = []) => (
    patterns.some((pattern) => wildcardMatches(action, pattern))
);

const canonicalizeAction = (action = '') => {
    const normalized = normalizeAction(action);
    return ACTION_ALIASES[normalized] || normalized;
};

const getSensitiveAction = (action = '', overrides = {}) => {
    const normalized = normalizeAction(action);
    const canonical = canonicalizeAction(normalized);
    const base = sensitiveActions[canonical] || {};
    const sensitivity = normalizeSensitivity(overrides.sensitivity || base.sensitivity || SENSITIVITIES.MEDIUM);
    const failClosed = Boolean(
        overrides.failClosed
        || base.failClosed
        || isCritical(sensitivity)
        || matchesAnyPattern(normalized, wildcardPatterns)
        || matchesAnyPattern(canonical, wildcardPatterns)
    );

    return {
        action: normalized || canonical || 'unknown',
        canonicalAction: canonical || normalized || 'unknown',
        sensitivity,
        stepUp: Boolean(overrides.stepUp ?? base.stepUp),
        failClosed,
        requireTenant: Boolean(overrides.requireTenant ?? base.requireTenant),
        requireDeviceProof: Boolean(overrides.requireDeviceProof ?? base.requireDeviceProof),
        requireAudit: Boolean(overrides.requireAudit ?? base.requireAudit),
    };
};

module.exports = {
    ACTION_ALIASES,
    canonicalizeAction,
    getSensitiveAction,
    matchesAnyPattern,
    sensitiveActions,
    wildcardMatches,
    wildcardPatterns,
};

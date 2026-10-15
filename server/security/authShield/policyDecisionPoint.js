const {
    DECISIONS,
    RISK_LEVELS,
    isCritical,
    isHighOrCritical,
    normalizeAction,
} = require('./types');

const adminRequired = (action = '') => (
    normalizeAction(action).startsWith('admin.')
    || normalizeAction(action).startsWith('security.')
);

const rolePolicyAllowed = ({ identity = {}, action = '' } = {}) => {
    if (adminRequired(action) && !identity.hasAdminRole) {
        return { allowed: false, reason: 'admin_required' };
    }
    return { allowed: true, reason: 'role_policy_allowed' };
};

const decide = ({
    identityResult = {},
    replay = {},
    dpop = {},
    device = {},
    relationship = {},
    risk = {},
    stepUp = {},
    action = '',
    sensitivity = 'medium',
    policyFailure = null,
} = {}) => {
    const identity = identityResult.identity || {};
    const reasons = [];
    const deny = (reason) => ({
        decision: DECISIONS.DENY,
        reasons: [...new Set([...reasons, reason].filter(Boolean))],
    });
    const step = (reason) => ({
        decision: DECISIONS.STEP_UP_REQUIRED,
        reasons: [...new Set([...reasons, reason].filter(Boolean))],
    });

    reasons.push(...(identityResult.reasons || []));
    // A missing identity is an AUTHENTICATION problem, not an authorization
    // one. This PDP authorizes principals; it does not authenticate them.
    // Denying here with a generic 403 would preempt the specific 401 contract
    // the authentication layer owns (sensitiveActionMiddleware maps
    // sensitive_action_authentication_required -> 401, and protect returns
    // 401 for its routes). Every sensitiveActions composition runs
    // requireSensitiveAction after this shield, and every admin/payment/auth
    // route runs protect, so an unauthenticated request is still blocked —
    // just with the correct, more specific error.
    if ((identityResult.reasons || []).includes('identity_missing')) {
        return {
            decision: DECISIONS.ALLOW,
            reasons: [...new Set([...reasons, 'identity_missing_deferred_to_auth'].filter(Boolean))],
        };
    }
    if ((identityResult.reasons || []).some((reason) => reason.startsWith('account_'))) return deny('account_not_active');
    if ((identityResult.reasons || []).includes('identity_unverified') && isHighOrCritical(sensitivity)) {
        return stepUp.enabled ? step('identity_unverified') : deny('identity_unverified');
    }
    if (relationship.reason === 'tenant_mismatch') return deny('tenant_mismatch');
    if (replay.ok === false) return deny(replay.replayed ? 'replay_detected' : replay.reasons?.[0]);
    if (dpop.ok === false) return deny(dpop.reasons?.[0] || 'dpop_denied');
    if (device.ok === false) return deny(device.reasons?.[0] || 'device_denied');
    if (stepUp.requiredByPolicy && stepUp.enabled && !stepUp.fresh) return step('stale_or_missing_step_up');
    if (relationship.allowed === false) return deny(relationship.reason || 'relationship_denied');

    const roleDecision = rolePolicyAllowed({ identity, action });
    if (!roleDecision.allowed) return deny(roleDecision.reason);

    if (policyFailure && isCritical(sensitivity)) return deny('policy_engine_failed');
    if (risk.level === RISK_LEVELS.CRITICAL && isCritical(sensitivity)) return deny('critical_risk');
    if (risk.level === RISK_LEVELS.HIGH && isHighOrCritical(sensitivity) && stepUp.enabled) {
        return step('high_risk_step_up_required');
    }

    return {
        decision: DECISIONS.ALLOW,
        reasons: [...new Set([...reasons, 'policy_allow'].filter(Boolean))],
    };
};

const policyAdapter = Object.freeze({
    evaluate: decide,
});

module.exports = {
    decide,
    policyAdapter,
    rolePolicyAllowed,
};

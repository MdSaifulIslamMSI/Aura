const {
    SECURITY_DECISIONS,
    SENSITIVITY_LEVELS,
    normalizeAction,
    sensitivityAtLeast,
} = require('./securityDecisionTypes');
const { resolveActionPolicy } = require('./actionSensitivityPolicy');
const { computeRiskScore } = require('./riskScoringService');
const { isFreshAuthSatisfied } = require('./freshAuthService');
const { writeSecurityEvent } = require('./securityEventLogger');

const DENYING_DECISIONS = new Set([
    SECURITY_DECISIONS.CHALLENGE,
    SECURITY_DECISIONS.THROTTLE,
    SECURITY_DECISIONS.DENY,
    SECURITY_DECISIONS.CONTAIN,
]);

const isEnabled = (env = process.env) => String(env.SECURITY_FRICTION_ENABLED || 'true').trim().toLowerCase() !== 'false';

const requiredControlsForPolicy = (policy = {}) => [
    policy.requiresAuth ? 'authenticated_user' : '',
    policy.requiresFreshAuth ? 'fresh_auth' : '',
    policy.requiresMfa ? 'fresh_mfa_or_passkey' : '',
    policy.requiresPasskeyForAdmin ? 'fresh_admin_passkey' : '',
    policy.requiresTenantBoundary ? 'tenant_boundary' : '',
    policy.requiresOwnerCheck ? 'owner_or_resource_check' : '',
    policy.requiresAudit ? 'audit_event' : '',
    policy.rateLimitPolicy ? 'adaptive_rate_limit' : '',
].filter(Boolean);

const hasAllowedRole = (context = {}, policy = {}) => {
    if (!Array.isArray(policy.allowedRoles) || policy.allowedRoles.length === 0) return true;
    const role = String(context.role || '').trim().toLowerCase();
    return policy.allowedRoles.map((entry) => String(entry).toLowerCase()).includes(role);
};

const buildAuditEvent = ({ context = {}, decision, reason, risk, policy }) => ({
    event: decision === SECURITY_DECISIONS.CONTAIN
        ? 'containment.triggered'
        : decision === SECURITY_DECISIONS.CHALLENGE
            ? 'auth.stepup.required'
            : decision === SECURITY_DECISIONS.THROTTLE
                ? 'rate.limit.hit'
                : decision === SECURITY_DECISIONS.DENY
                    ? 'access.denied'
                    : 'security.decision.allowed',
    action: context.action,
    route: context.route,
    method: context.method,
    decision,
    reasonCode: reason,
    riskScore: risk.riskScore,
    sensitivity: policy.sensitivity,
});

const makeDecision = ({ context, policy, risk, decision, reason, containmentActions = [] }) => ({
    decision,
    action: normalizeAction(context.action || policy.action || ''),
    reason,
    riskScore: risk.riskScore,
    riskLevel: risk.level,
    riskReasons: risk.reasons,
    sensitivity: policy.sensitivity,
    requiredControls: requiredControlsForPolicy(policy),
    auditEvent: buildAuditEvent({ context, decision, reason, risk, policy }),
    containmentActions,
});

const evaluateSecurityDecision = (context = {}, options = {}) => {
    const env = options.env || process.env;
    const action = normalizeAction(options.action || context.action || '');
    const policy = resolveActionPolicy(action, options.policyOverrides || {});
    const normalizedContext = { ...context, action };
    const risk = computeRiskScore(normalizedContext, policy);

    let decision = SECURITY_DECISIONS.ALLOW;
    let reason = 'allowed';
    let containmentActions = [];

    if (!isEnabled(env)) {
        decision = policy.requiresAudit ? SECURITY_DECISIONS.ALLOW_WITH_AUDIT : SECURITY_DECISIONS.ALLOW;
        reason = 'friction_disabled';
    } else if (policy.unknownSensitiveAction) {
        decision = SECURITY_DECISIONS.DENY;
        reason = 'unknown_sensitive_action';
    } else if (policy.requiresAuth && !normalizedContext.userId) {
        decision = SECURITY_DECISIONS.DENY;
        reason = 'authenticated_user_missing';
    } else if (!hasAllowedRole(normalizedContext, policy)) {
        decision = SECURITY_DECISIONS.DENY;
        reason = 'role_not_allowed';
    } else if (policy.requiresTenantBoundary && !normalizedContext.tenantId) {
        decision = SECURITY_DECISIONS.DENY;
        reason = 'tenant_boundary_missing';
    } else if (policy.requiresOwnerCheck && !normalizedContext.resourceOwnerId && !normalizedContext.resourceId) {
        decision = SECURITY_DECISIONS.DENY;
        reason = 'owner_or_resource_check_missing';
    } else {
        const freshAuth = isFreshAuthSatisfied(normalizedContext, policy, env);
        if (!freshAuth.ok) {
            decision = sensitivityAtLeast(policy.sensitivity, SENSITIVITY_LEVELS.CRITICAL)
                ? SECURITY_DECISIONS.CHALLENGE
                : SECURITY_DECISIONS.DENY;
            reason = freshAuth.reason;
        } else if (risk.riskScore >= 85 && sensitivityAtLeast(policy.sensitivity, SENSITIVITY_LEVELS.HIGH)) {
            decision = SECURITY_DECISIONS.CONTAIN;
            reason = 'risk_exceeds_sensitive_threshold';
            containmentActions = policy.containmentPolicy || [];
        } else if (risk.riskScore > policy.maxRiskAllowed) {
            if (sensitivityAtLeast(policy.sensitivity, SENSITIVITY_LEVELS.CRITICAL)) {
                decision = SECURITY_DECISIONS.CONTAIN;
                reason = 'risk_exceeds_critical_threshold';
                containmentActions = policy.containmentPolicy || [];
            } else if (sensitivityAtLeast(policy.sensitivity, SENSITIVITY_LEVELS.HIGH)) {
                decision = SECURITY_DECISIONS.CHALLENGE;
                reason = 'risk_exceeds_step_up_threshold';
            } else {
                decision = SECURITY_DECISIONS.THROTTLE;
                reason = 'risk_exceeds_rate_threshold';
            }
        } else if (policy.requiresAudit || sensitivityAtLeast(policy.sensitivity, SENSITIVITY_LEVELS.MEDIUM)) {
            decision = SECURITY_DECISIONS.ALLOW_WITH_AUDIT;
            reason = 'allowed_with_audit';
        }
    }

    const result = makeDecision({
        context: normalizedContext,
        policy,
        risk,
        decision,
        reason,
        containmentActions,
    });

    if (DENYING_DECISIONS.has(decision) || decision === SECURITY_DECISIONS.ALLOW_WITH_AUDIT) {
        writeSecurityEvent({
            event: result.auditEvent.event,
            userId: normalizedContext.userId,
            tenantId: normalizedContext.tenantId,
            action,
            route: normalizedContext.route,
            method: normalizedContext.method,
            ipHash: normalizedContext.ipHash,
            userAgentHash: normalizedContext.userAgentHash,
            riskScore: result.riskScore,
            decision,
            reasonCode: reason,
            environment: normalizedContext.environment,
            metadata: {
                sensitivity: result.sensitivity,
                requiredControls: result.requiredControls,
                containmentActions,
                riskReasons: result.riskReasons,
            },
        });
    }

    return result;
};

module.exports = {
    DENYING_DECISIONS,
    evaluateSecurityDecision,
    requiredControlsForPolicy,
};

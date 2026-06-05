const { normalizeAction } = require('../security/authShield/types');

const RISK_SCORES = Object.freeze({
    low: 0,
    medium: 30,
    high: 60,
    critical: 85,
});

const clampScore = (score) => Math.max(0, Math.min(100, Number(score) || 0));

const levelFromScore = (score) => {
    if (score >= RISK_SCORES.critical) return 'critical';
    if (score >= RISK_SCORES.high) return 'high';
    if (score >= RISK_SCORES.medium) return 'medium';
    return 'low';
};

const evaluateAlienRisk = ({
    user = {},
    session = {},
    device = {},
    action = '',
    resource = {},
    request = {},
} = {}) => {
    let score = 0;
    const reasons = [];
    const add = (points, reason) => {
        score += points;
        reasons.push(reason);
    };
    const normalizedAction = normalizeAction(action);

    if (!device?.deviceId && !request.headers?.['x-aura-device-id']) add(20, 'new_or_missing_device');
    if (!session?.sessionId && !request.authSession?.sessionId) add(15, 'missing_session');
    if (!request.headers?.['user-agent']) add(10, 'missing_user_agent');
    if (normalizedAction.startsWith('admin.')) add(25, 'sensitive_admin_action');
    if (normalizedAction.includes('refund') || normalizedAction.includes('payout') || normalizedAction.startsWith('payment.')) {
        add(25, 'payment_or_refund_action');
    }
    if (normalizedAction.includes('delete') || normalizedAction.includes('secret') || normalizedAction.includes('apikey')) {
        add(20, 'destructive_or_secret_action');
    }
    if (resource?.tenantId && user?.tenantId && String(resource.tenantId) !== String(user.tenantId)) {
        add(100, 'tenant_boundary_mismatch');
    }
    if (Number(session?.authAgeSeconds ?? request.authSession?.authAgeSeconds ?? 0) > 30 * 60) {
        add(15, 'older_session');
    }
    if (Array.isArray(user?.adminRoles) && user.adminRoles.includes('SUPER_ADMIN')) {
        add(10, 'privileged_role');
    }
    if (request.alienOtpFailures >= 3) add(20, 'many_failed_attempts');

    const scoreClamped = clampScore(score);
    const riskLevel = levelFromScore(scoreClamped);
    return {
        riskLevel,
        level: riskLevel,
        score: scoreClamped,
        reasons: [...new Set(reasons)],
        requiresAlienProof: riskLevel !== 'low' || normalizedAction.startsWith('admin.') || normalizedAction.startsWith('payment.'),
        requiresExplicitStepUp: riskLevel === 'high',
        block: riskLevel === 'critical',
    };
};

module.exports = {
    evaluateAlienRisk,
};

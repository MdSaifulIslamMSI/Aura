const {
    clampRiskScore,
    riskLevelForScore,
} = require('../trustDecision');

const normalizeText = (value = '') => String(value || '').trim().toLowerCase();

const addFactor = (state, condition, score, reason) => {
    if (!condition) return;
    state.score += score;
    state.factors.push(reason);
};

const evaluateRisk = ({
    actor = {},
    policy = {},
    request = {},
    session = {},
    device = {},
    resource = {},
    rateSignals = {},
    systemHealth = {},
    sensitiveAction = {},
} = {}) => {
    const state = { score: 0, factors: [] };
    const userAgent = normalizeText(request.userAgent || request.headers?.['user-agent']);

    addFactor(state, policy.sensitive, 10, 'sensitive_action');
    addFactor(state, policy.highValue || Number(resource.totalPrice || resource.amount || 0) >= 50000, 20, 'high_value_action');
    addFactor(state, !device?.trusted && policy.sensitive, 10, 'unknown_device');
    addFactor(state, !session && policy.sensitive, 10, 'missing_trusted_session');
    addFactor(state, Boolean(session?.newIp || request.newIp || request.unusualIp), 15, 'new_or_unusual_ip');
    addFactor(state, Number(rateSignals.actorRouteVelocity || 0) >= 30, 20, 'high_actor_route_velocity');
    addFactor(state, Number(rateSignals.ipRouteVelocity || 0) >= 60, 20, 'high_ip_route_velocity');
    addFactor(state, Number(rateSignals.ownershipMismatchCount || 0) >= 3, 30, 'repeated_ownership_mismatch');
    addFactor(state, Number(rateSignals.authFailureCount || 0) >= 3, 25, 'repeated_auth_failure');
    addFactor(state, Number(rateSignals.adminSensitiveActionCount || 0) >= 10, 20, 'admin_sensitive_action_velocity');
    addFactor(state, Number(rateSignals.paymentWebhookReplayCount || 0) > 0 || resource.duplicate, 35, 'payment_webhook_replay');
    addFactor(state, Number(rateSignals.uploadFailureCount || 0) >= 3, 15, 'upload_failure_velocity');
    addFactor(state, Number(rateSignals.aiEndpointUsageCount || 0) >= 40, 20, 'ai_endpoint_velocity');
    addFactor(state, Number(rateSignals.objectIdsTouched || 0) >= 20, 30, 'object_id_probing');
    addFactor(state, sensitiveAction.requiredStepUp && !sensitiveAction.ok, 25, 'sensitive_action_without_fresh_step_up');
    addFactor(state, /curl|sqlmap|nikto|acunetix|masscan|nmap|bot|spider/.test(userAgent), 20, 'suspicious_user_agent');
    addFactor(state, Boolean(systemHealth.endpointUnderAbuse), 30, 'endpoint_under_abuse');
    addFactor(state, systemHealth.status === 'degraded' && policy.riskyWrite, 15, 'degraded_system_risky_write');

    const score = clampRiskScore(state.score);
    return {
        ok: score < Number(policy.riskThreshold || 60),
        reason: score >= Number(policy.riskThreshold || 60) ? 'HIGH_RISK_ACTION' : 'RISK_ACCEPTABLE',
        riskScore: score,
        riskLevel: riskLevelForScore(score),
        factors: state.factors,
    };
};

module.exports = {
    evaluateRisk,
};

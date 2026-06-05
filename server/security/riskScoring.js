const { SENSITIVITY_LEVELS } = require('./actionSensitivityRegistry');
const { clampRiskScore, decisionFromRiskScore } = require('./securityDecision');

const SENSITIVITY_BASE_SCORE = Object.freeze({
    [SENSITIVITY_LEVELS.LOW]: 10,
    [SENSITIVITY_LEVELS.MEDIUM]: 35,
    [SENSITIVITY_LEVELS.HIGH]: 50,
    [SENSITIVITY_LEVELS.CRITICAL]: 70,
});

const toNumber = (value, fallback = 0) => {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : fallback;
};

const sameNonEmpty = (left = '', right = '') => {
    const normalizedLeft = String(left || '').trim();
    const normalizedRight = String(right || '').trim();
    return Boolean(normalizedLeft && normalizedRight && normalizedLeft === normalizedRight);
};

const calculateRiskScore = ({
    actionDefinition = {},
    context = {},
    resource = {},
    signals = {},
    incidentMode = 'normal',
} = {}) => {
    let riskScore = SENSITIVITY_BASE_SCORE[actionDefinition.sensitivity] || 25;
    const reasons = [`sensitivity_${String(actionDefinition.sensitivity || 'unknown').toLowerCase()}`];
    const requiredControls = [];

    const addRisk = (points, reason, control = '') => {
        riskScore += points;
        if (reason) reasons.push(reason);
        if (control) requiredControls.push(control);
    };

    if (actionDefinition.requiresAuth && !context.actorId) {
        addRisk(30, 'missing_authentication', 'authenticated_session');
    }

    if (actionDefinition.requiresTenant && !context.tenantId) {
        addRisk(15, 'missing_tenant_context', 'tenant_context');
    }

    if (context.actorRole === 'admin') {
        addRisk(5, 'admin_actor');
    }

    if (actionDefinition.requiresFreshMfa && !context.mfaFresh) {
        addRisk(15, 'missing_fresh_mfa', 'fresh_mfa');
    }

    if (actionDefinition.requiresTrustedDevice && !context.trustedDevice) {
        addRisk(10, 'untrusted_device', 'trusted_device');
    }

    const sessionAgeSeconds = toNumber(context.sessionAgeSeconds, 0);
    if (sessionAgeSeconds > 12 * 60 * 60) {
        addRisk(10, 'stale_session_over_12h', 'fresh_session');
    } else if (sessionAgeSeconds > 60 * 60) {
        addRisk(5, 'stale_session_over_1h', 'fresh_session');
    }

    const failedLoginCount = Math.max(0, toNumber(signals.failedLoginCount, 0));
    if (failedLoginCount > 0) {
        addRisk(Math.min(20, failedLoginCount * 4), 'failed_login_history');
    }

    const rateLimitHits = Math.max(0, toNumber(signals.rateLimitHits, 0));
    if (rateLimitHits > 0) {
        addRisk(Math.min(20, rateLimitHits * 5), 'rate_limit_history');
    }

    const payloadSize = toNumber(context.payloadSize, 0);
    if (payloadSize > 10 * 1024 * 1024) {
        addRisk(20, 'payload_size_anomaly_large');
    } else if (payloadSize > 1024 * 1024) {
        addRisk(10, 'payload_size_anomaly_medium');
    }

    const action = String(actionDefinition.action || context.action || '').trim();
    if (/^payment\.(refund|payout)/.test(action)) {
        addRisk(10, 'payment_refund_or_payout_sensitivity');
    }
    if (/^upload\./.test(action)) {
        addRisk(5, 'upload_surface');
    }
    if (action === 'ai.tool.execute') {
        addRisk(10, 'ai_tool_call_risk');
    }

    const resourceTenantId = resource.tenantId || resource.ownerTenantId;
    const crossTenantMismatch = Boolean(
        resourceTenantId
        && context.tenantId
        && !sameNonEmpty(resourceTenantId, context.tenantId)
    ) || Boolean(signals.crossTenantMismatch);
    if (crossTenantMismatch) {
        addRisk(25, 'cross_tenant_mismatch', 'tenant_isolation');
    }

    if (incidentMode === 'lockdown') {
        addRisk(30, 'incident_mode_lockdown', 'incident_response_review');
    } else if (incidentMode === 'heightened') {
        addRisk(10, 'incident_mode_heightened');
    }

    const normalizedRiskScore = clampRiskScore(riskScore);

    return {
        riskScore: normalizedRiskScore,
        decision: decisionFromRiskScore(normalizedRiskScore),
        reasons: [...new Set(reasons)],
        requiredControls: [...new Set(requiredControls)],
    };
};

module.exports = {
    SENSITIVITY_BASE_SCORE,
    calculateRiskScore,
};

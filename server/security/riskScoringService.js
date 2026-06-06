const {
    RISK_LEVELS,
    normalizeSensitivity,
} = require('./securityDecisionTypes');
const { getSensitivityRank } = require('./actionSensitivityPolicy');

const clampRiskScore = (value) => Math.max(0, Math.min(100, Number(value) || 0));

const riskLevelForScore = (score) => {
    if (score >= 85) return RISK_LEVELS.CRITICAL;
    if (score >= 65) return RISK_LEVELS.HIGH;
    if (score >= 35) return RISK_LEVELS.MEDIUM;
    return RISK_LEVELS.LOW;
};

const numeric = (value, fallback = 0) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
};

const computeRiskScore = (context = {}, policy = {}) => {
    const reasons = [];
    let score = 0;

    const sensitivity = normalizeSensitivity(policy.sensitivity || context.sensitivity || 'low');
    score += Math.max(0, getSensitivityRank(sensitivity) - 1) * 8;

    if (context.deviceTrust === 'trusted') score -= 10;
    if (context.deviceTrust === 'unknown' || !context.deviceTrust) {
        score += 12;
        reasons.push('device_unknown');
    }
    if (context.deviceTrust === 'untrusted') {
        score += 25;
        reasons.push('device_untrusted');
    }

    if (context.csrfVerified === false && policy.requiresAuth) {
        score += 20;
        reasons.push('csrf_missing');
    }

    if (policy.requiresFreshAuth && !context.mfaFresh && !context.passkeyFresh) {
        score += 18;
        reasons.push('fresh_auth_missing');
    }

    const requestVelocity = numeric(context.requestVelocity);
    if (requestVelocity >= 50) {
        score += 35;
        reasons.push('request_velocity_critical');
    } else if (requestVelocity >= 20) {
        score += 25;
        reasons.push('request_velocity_high');
    } else if (requestVelocity >= 8) {
        score += 12;
        reasons.push('request_velocity_medium');
    }

    const failedAttemptCount = numeric(context.failedAttemptCount);
    if (failedAttemptCount >= 10) {
        score += 30;
        reasons.push('failed_attempts_critical');
    } else if (failedAttemptCount >= 5) {
        score += 20;
        reasons.push('failed_attempts_high');
    } else if (failedAttemptCount >= 2) {
        score += 10;
        reasons.push('failed_attempts_medium');
    }

    const previousSecurityEvents = numeric(context.previousSecurityEvents);
    if (previousSecurityEvents >= 5) {
        score += 25;
        reasons.push('prior_security_events_high');
    } else if (previousSecurityEvents > 0) {
        score += 10;
        reasons.push('prior_security_events');
    }

    const payloadRisk = numeric(context.payloadRisk);
    if (payloadRisk >= 70) {
        score += 30;
        reasons.push('payload_risk_high');
    } else if (payloadRisk >= 35) {
        score += 15;
        reasons.push('payload_risk_medium');
    }

    if (context.ipHash && context.userAgentHash) score -= 3;
    if (context.environment === 'test') score = numeric(context.testRiskScore, score);

    const riskScore = clampRiskScore(score);
    return {
        riskScore,
        level: riskLevelForScore(riskScore),
        reasons: [...new Set(reasons)],
    };
};

module.exports = {
    clampRiskScore,
    computeRiskScore,
    riskLevelForScore,
};

const {
    RISK_LEVELS,
    isCritical,
    isHighOrCritical,
    normalizeAction,
} = require('./types');

const deniedCounters = new Map();

const clampScore = (value) => Math.max(0, Math.min(100, Number(value) || 0));

const levelFromScore = (score) => {
    if (score >= 85) return RISK_LEVELS.CRITICAL;
    if (score >= 60) return RISK_LEVELS.HIGH;
    if (score >= 30) return RISK_LEVELS.MEDIUM;
    return RISK_LEVELS.LOW;
};

const denyCounterKey = (identity = {}, action = '') => `${identity.userId || 'anonymous'}:${normalizeAction(action) || 'unknown'}`;

const recordDeniedDecision = (identity = {}, action = '') => {
    const key = denyCounterKey(identity, action);
    const current = deniedCounters.get(key) || { count: 0, expiresAt: 0 };
    const now = Date.now();
    const next = {
        count: current.expiresAt > now ? current.count + 1 : 1,
        expiresAt: now + (10 * 60 * 1000),
    };
    deniedCounters.set(key, next);
    return next.count;
};

const getDeniedCount = (identity = {}, action = '') => {
    const entry = deniedCounters.get(denyCounterKey(identity, action));
    if (!entry || entry.expiresAt <= Date.now()) return 0;
    return entry.count;
};

const hasSuspiciousCriticalBody = (body = {}) => {
    if (!body || typeof body !== 'object') return false;
    return Object.keys(body).some((key) => /(isAdmin|adminRoles|role|roles|password|otp|token|card|cvv|secret)/i.test(key));
};

const evaluateRisk = ({
    identity = {},
    session = {},
    action = '',
    resource = {},
    relationship = {},
    replay = {},
    req = {},
    sensitivity = 'medium',
    config = {},
} = {}) => {
    if (config.riskEngineEnabled === false) {
        return { level: RISK_LEVELS.LOW, score: 0, reasons: [] };
    }

    let score = 0;
    const reasons = [];
    const add = (points, reason) => {
        score += points;
        reasons.push(reason);
    };

    if (!session.userAgent) add(10, 'missing_user_agent');
    if (!session.requestId) add(10, 'missing_request_id');
    if (session.authAgeSeconds === null && isHighOrCritical(sensitivity)) add(20, 'missing_auth_time');
    if (Number(session.authAgeSeconds) > 15 * 60 && isHighOrCritical(sensitivity)) add(20, 'stale_auth_time');
    if (!session.deviceId && isHighOrCritical(sensitivity)) add(15, 'missing_device_id');
    if (normalizeAction(action).startsWith('admin.') && !session.deviceId) add(20, 'admin_unknown_device');
    if (normalizeAction(action).startsWith('payment.') && !session.deviceId) add(20, 'payment_unknown_device');
    if (relationship.reason === 'tenant_mismatch') add(100, 'tenant_mismatch');
    if (replay.replayed) add(100, 'replay_attempt');
    if (getDeniedCount(identity, action) >= 3) add(20, 'repeated_denied_decisions');
    if (isCritical(sensitivity) && hasSuspiciousCriticalBody(req.body)) add(10, 'suspicious_body_keys');
    if (resource?.tenantId && identity?.tenantId && String(resource.tenantId) !== String(identity.tenantId)) {
        add(100, 'tenant_mismatch');
    }

    const finalScore = clampScore(score);
    return {
        level: levelFromScore(finalScore),
        score: finalScore,
        reasons: [...new Set(reasons)],
    };
};

const resetRiskMemoryForTests = () => deniedCounters.clear();

module.exports = {
    evaluateRisk,
    getDeniedCount,
    recordDeniedDecision,
    resetRiskMemoryForTests,
};

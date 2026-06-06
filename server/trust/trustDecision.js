const crypto = require('crypto');

const DECISIONS = Object.freeze({
    ALLOW: 'ALLOW',
    AUDIT_ONLY: 'AUDIT_ONLY',
    CHALLENGE: 'CHALLENGE',
    THROTTLE: 'THROTTLE',
    BLOCK: 'BLOCK',
    QUARANTINE: 'QUARANTINE',
});

const ENFORCEMENT_MODES = Object.freeze({
    OFF: 'off',
    SHADOW: 'shadow',
    ENFORCE_SAFE: 'enforce-safe',
    ENFORCE_SENSITIVE: 'enforce-sensitive',
});

const RISK_LEVELS = Object.freeze({
    LOW: 'low',
    MEDIUM: 'medium',
    HIGH: 'high',
    CRITICAL: 'critical',
});

const ALLOWED_MODES = new Set(Object.values(ENFORCEMENT_MODES));

const normalizeMode = (value = '') => {
    const mode = String(value || '').trim().toLowerCase();
    return ALLOWED_MODES.has(mode) ? mode : ENFORCEMENT_MODES.SHADOW;
};

const clampRiskScore = (value = 0) => {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return 0;
    if (numeric < 0) return 0;
    if (numeric > 100) return 100;
    return Math.round(numeric);
};

const riskLevelForScore = (score = 0) => {
    const normalized = clampRiskScore(score);
    if (normalized >= 80) return RISK_LEVELS.CRITICAL;
    if (normalized >= 60) return RISK_LEVELS.HIGH;
    if (normalized >= 30) return RISK_LEVELS.MEDIUM;
    return RISK_LEVELS.LOW;
};

const safeString = (value = '') => String(value || '').trim();

const createDecisionId = () => `trust_${crypto.randomUUID()}`;

const normalizeActorId = (actor = {}) => safeString(
    actor.actorId
    || actor.userId
    || actor._id
    || actor.id
    || actor.authUid
    || actor.email
);

const normalizeResourceId = (resource = {}) => safeString(
    resource.resourceId
    || resource._id
    || resource.id
    || resource.intentId
    || resource.eventId
);

const createEvidence = ({
    actor = {},
    action = '',
    resource = {},
    request = {},
    decisionId = createDecisionId(),
    timestamp = new Date().toISOString(),
} = {}) => ({
    actorId: normalizeActorId(actor),
    action: safeString(action),
    resourceType: safeString(resource.resourceType || resource.type),
    resourceId: normalizeResourceId(resource),
    route: safeString(request.route || request.path || request.originalUrl || request.url),
    requestId: safeString(request.requestId || request.id),
    decisionId,
    timestamp,
});

const isEnforceMode = (mode = '') => [
    ENFORCEMENT_MODES.ENFORCE_SAFE,
    ENFORCEMENT_MODES.ENFORCE_SENSITIVE,
].includes(normalizeMode(mode));

const isShadowMode = (mode = '') => normalizeMode(mode) === ENFORCEMENT_MODES.SHADOW;

const buildTrustDecision = ({
    decision = DECISIONS.ALLOW,
    allowed,
    reason = 'ALLOW',
    riskScore = 0,
    riskLevel = '',
    requiredStepUp = null,
    audit = true,
    enforcementMode = ENFORCEMENT_MODES.SHADOW,
    evidence = {},
    metadata = {},
} = {}) => {
    const normalizedDecision = Object.values(DECISIONS).includes(decision)
        ? decision
        : DECISIONS.ALLOW;
    const normalizedRiskScore = clampRiskScore(riskScore);
    return {
        decision: normalizedDecision,
        allowed: typeof allowed === 'boolean'
            ? allowed
            : [DECISIONS.ALLOW, DECISIONS.AUDIT_ONLY].includes(normalizedDecision),
        reason: safeString(reason || normalizedDecision),
        riskScore: normalizedRiskScore,
        riskLevel: riskLevel || riskLevelForScore(normalizedRiskScore),
        requiredStepUp: requiredStepUp || null,
        audit: Boolean(audit),
        enforcementMode: normalizeMode(enforcementMode),
        evidence,
        metadata,
    };
};

module.exports = {
    DECISIONS,
    ENFORCEMENT_MODES,
    RISK_LEVELS,
    buildTrustDecision,
    clampRiskScore,
    createDecisionId,
    createEvidence,
    isEnforceMode,
    isShadowMode,
    normalizeActorId,
    normalizeMode,
    normalizeResourceId,
    riskLevelForScore,
};

const SECURITY_DECISIONS = Object.freeze({
    ALLOW: 'ALLOW',
    AUDIT: 'AUDIT',
    STEP_UP: 'STEP_UP',
    DENY: 'DENY',
    LOCKDOWN: 'LOCKDOWN',
});

const BLOCKING_DECISIONS = new Set([
    SECURITY_DECISIONS.STEP_UP,
    SECURITY_DECISIONS.DENY,
    SECURITY_DECISIONS.LOCKDOWN,
]);

const clampRiskScore = (value = 0) => {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return 0;
    return Math.min(100, Math.max(0, Math.round(numeric)));
};

const uniqueStrings = (values = []) => [
    ...new Set(
        (Array.isArray(values) ? values : [values])
            .map((entry) => String(entry || '').trim())
            .filter(Boolean)
    ),
];

const normalizeDecision = (decision = SECURITY_DECISIONS.ALLOW) => {
    const normalized = String(decision || '').trim().toUpperCase();
    return Object.values(SECURITY_DECISIONS).includes(normalized)
        ? normalized
        : SECURITY_DECISIONS.ALLOW;
};

const createSecurityDecision = ({
    decision = SECURITY_DECISIONS.ALLOW,
    riskScore = 0,
    reasons = [],
    requiredControls = [],
    auditRequired = false,
    enforceable = false,
    createdAt = new Date().toISOString(),
} = {}) => {
    const normalizedDecision = normalizeDecision(decision);
    const normalizedReasons = uniqueStrings(reasons);
    const normalizedControls = uniqueStrings(requiredControls);

    if (
        [SECURITY_DECISIONS.DENY, SECURITY_DECISIONS.LOCKDOWN].includes(normalizedDecision)
        && normalizedReasons.length === 0
    ) {
        normalizedReasons.push('security_decision_requires_reason');
    }

    if (normalizedDecision === SECURITY_DECISIONS.STEP_UP && normalizedControls.length === 0) {
        normalizedControls.push('fresh_mfa');
    }

    return {
        decision: normalizedDecision,
        riskScore: clampRiskScore(riskScore),
        reasons: normalizedReasons,
        requiredControls: normalizedControls,
        auditRequired: Boolean(auditRequired),
        enforceable: Boolean(enforceable && BLOCKING_DECISIONS.has(normalizedDecision)),
        createdAt,
    };
};

const decisionFromRiskScore = (riskScore = 0) => {
    const score = clampRiskScore(riskScore);
    if (score >= 95) return SECURITY_DECISIONS.LOCKDOWN;
    if (score >= 80) return SECURITY_DECISIONS.DENY;
    if (score >= 60) return SECURITY_DECISIONS.STEP_UP;
    if (score >= 30) return SECURITY_DECISIONS.AUDIT;
    return SECURITY_DECISIONS.ALLOW;
};

const isBlockingDecision = (decision = '') => BLOCKING_DECISIONS.has(normalizeDecision(decision));

module.exports = {
    BLOCKING_DECISIONS,
    SECURITY_DECISIONS,
    clampRiskScore,
    createSecurityDecision,
    decisionFromRiskScore,
    isBlockingDecision,
    normalizeDecision,
};

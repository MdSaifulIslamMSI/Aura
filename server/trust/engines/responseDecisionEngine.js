const {
    DECISIONS,
    ENFORCEMENT_MODES,
    buildTrustDecision,
    isEnforceMode,
    normalizeMode,
} = require('../trustDecision');

const isSensitiveEnforcementEnabled = ({ mode = '', config = {} } = {}) => (
    normalizeMode(mode) === ENFORCEMENT_MODES.ENFORCE_SENSITIVE
    && (config.enforceAdminStepUp || config.enforceRisk)
);

const blockInShadowOrEnforce = ({
    mode,
    config,
    reason,
    risk,
    requiredStepUp = null,
    evidence,
    policy,
    metadata = {},
} = {}) => {
    const normalizedMode = normalizeMode(mode);
    if (normalizedMode === ENFORCEMENT_MODES.SHADOW) {
        return buildTrustDecision({
            decision: DECISIONS.AUDIT_ONLY,
            reason,
            riskScore: risk.riskScore,
            riskLevel: risk.riskLevel,
            requiredStepUp,
            enforcementMode: normalizedMode,
            evidence,
            metadata,
        });
    }

    if (reason === 'RESOURCE_OWNERSHIP_MISMATCH' && config.enforceOwnership) {
        return buildTrustDecision({
            decision: DECISIONS.BLOCK,
            reason,
            riskScore: risk.riskScore,
            riskLevel: risk.riskLevel,
            requiredStepUp,
            enforcementMode: normalizedMode,
            evidence,
            metadata,
        });
    }

    if (reason === 'PAYMENT_WEBHOOK_REPLAY' && isEnforceMode(normalizedMode)) {
        return buildTrustDecision({
            decision: DECISIONS.BLOCK,
            reason,
            riskScore: risk.riskScore,
            riskLevel: risk.riskLevel,
            requiredStepUp,
            enforcementMode: normalizedMode,
            evidence,
            metadata,
        });
    }

    if (reason === 'PERMISSION_DENIED' && isEnforceMode(normalizedMode)) {
        return buildTrustDecision({
            decision: DECISIONS.BLOCK,
            reason,
            riskScore: risk.riskScore,
            riskLevel: risk.riskLevel,
            requiredStepUp,
            enforcementMode: normalizedMode,
            evidence,
            metadata,
        });
    }

    if (reason === 'IDENTITY_REQUIRED') {
        return buildTrustDecision({
            decision: DECISIONS.BLOCK,
            reason,
            riskScore: risk.riskScore,
            riskLevel: risk.riskLevel,
            requiredStepUp,
            enforcementMode: normalizedMode,
            evidence,
            metadata,
        });
    }

    if (reason === 'STEP_UP_REQUIRED' && isSensitiveEnforcementEnabled({ mode: normalizedMode, config })) {
        return buildTrustDecision({
            decision: DECISIONS.CHALLENGE,
            reason,
            riskScore: risk.riskScore,
            riskLevel: risk.riskLevel,
            requiredStepUp,
            enforcementMode: normalizedMode,
            evidence,
            metadata,
        });
    }

    if (reason === 'HIGH_RISK_ACTION' && normalizeMode(normalizedMode) === ENFORCEMENT_MODES.ENFORCE_SENSITIVE && config.enforceRisk) {
        const decision = risk.riskLevel === 'critical' && policy.protectedCriticalRisk
            ? DECISIONS.BLOCK
            : DECISIONS.CHALLENGE;
        return buildTrustDecision({
            decision,
            reason,
            riskScore: risk.riskScore,
            riskLevel: risk.riskLevel,
            requiredStepUp,
            enforcementMode: normalizedMode,
            evidence,
            metadata,
        });
    }

    if (reason === 'SYSTEM_HEALTH_DEGRADED' && isEnforceMode(normalizedMode)) {
        return buildTrustDecision({
            decision: DECISIONS.THROTTLE,
            reason,
            riskScore: risk.riskScore,
            riskLevel: risk.riskLevel,
            requiredStepUp,
            enforcementMode: normalizedMode,
            evidence,
            metadata,
        });
    }

    return buildTrustDecision({
        decision: isEnforceMode(normalizedMode) ? DECISIONS.AUDIT_ONLY : DECISIONS.AUDIT_ONLY,
        reason,
        riskScore: risk.riskScore,
        riskLevel: risk.riskLevel,
        requiredStepUp,
        enforcementMode: normalizedMode,
        evidence,
        metadata,
    });
};

const buildResponseDecision = ({
    mode,
    config = {},
    policy = {},
    evidence = {},
    identity = {},
    authorization = {},
    ownership = {},
    resourceState = {},
    sensitiveAction = {},
    systemHealth = {},
    risk = {},
    metadata = {},
} = {}) => {
    const normalizedMode = normalizeMode(mode);
    const safeRisk = {
        riskScore: Number(risk.riskScore || 0),
        riskLevel: risk.riskLevel || 'low',
    };

    if (normalizedMode === ENFORCEMENT_MODES.OFF || !config.enabled) {
        return buildTrustDecision({
            decision: DECISIONS.ALLOW,
            reason: 'TRUST_FABRIC_OFF',
            audit: false,
            enforcementMode: ENFORCEMENT_MODES.OFF,
            evidence,
            metadata,
        });
    }

    const firstFailure = [
        identity,
        authorization,
        ownership,
        resourceState,
        sensitiveAction,
        systemHealth,
        risk,
    ].find((result) => result && result.ok === false);

    if (!firstFailure) {
        return buildTrustDecision({
            decision: DECISIONS.ALLOW,
            reason: 'ALLOW',
            riskScore: safeRisk.riskScore,
            riskLevel: safeRisk.riskLevel,
            enforcementMode: normalizedMode,
            evidence,
            metadata,
        });
    }

    return blockInShadowOrEnforce({
        mode: normalizedMode,
        config,
        reason: firstFailure.reason,
        risk: safeRisk,
        requiredStepUp: sensitiveAction.requiredStepUp || null,
        evidence,
        policy,
        metadata,
    });
};

module.exports = {
    buildResponseDecision,
};

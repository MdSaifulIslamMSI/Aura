const { calculateRiskScore } = require('./riskScoring');
const {
    SECURITY_DECISIONS,
    createSecurityDecision,
    isBlockingDecision,
} = require('./securityDecision');
const { resolveSecurityFabricConfig } = require('./securityFabricConfig');

const evaluateAuraSecurityBrain = ({
    actionDefinition = {},
    context = {},
    resource = {},
    signals = {},
    incidentMode = 'normal',
    config = resolveSecurityFabricConfig(),
} = {}) => {
    if (!config.securityBrainEnabled) {
        return createSecurityDecision({
            decision: SECURITY_DECISIONS.ALLOW,
            riskScore: 0,
            reasons: ['security_brain_disabled'],
            auditRequired: Boolean(actionDefinition.requiresAudit),
            enforceable: false,
        });
    }

    const scored = calculateRiskScore({
        actionDefinition,
        context,
        resource,
        signals,
        incidentMode,
    });
    const reasons = [...scored.reasons];
    if (config.auditOnly) {
        reasons.push('audit_only');
    }

    const auditRequired = Boolean(
        actionDefinition.requiresAudit
        || scored.decision !== SECURITY_DECISIONS.ALLOW
    );
    const enforceable = Boolean(
        config.enforce
        && config.securityBrainEnforce
        && isBlockingDecision(scored.decision)
    );

    return createSecurityDecision({
        decision: scored.decision,
        riskScore: scored.riskScore,
        reasons,
        requiredControls: scored.requiredControls,
        auditRequired,
        enforceable,
    });
};

module.exports = {
    evaluateAuraSecurityBrain,
};

const { recordSecurityAuditEvent } = require('../services/securityAuditService');
const { redactSecurityValue } = require('./redaction');
const { SECURITY_DECISIONS } = require('./securityDecision');
const { resolveSecurityFabricConfig } = require('./securityFabricConfig');

const EVENT_TYPE = 'aura.security_fabric.decision';

const riskLevelFromScore = (riskScore = 0) => {
    if (riskScore >= 80) return 'critical';
    if (riskScore >= 60) return 'high';
    if (riskScore >= 30) return 'medium';
    return 'low';
};

const resultFromDecision = ({ decision = SECURITY_DECISIONS.ALLOW, auditOnly = true } = {}) => {
    if (auditOnly && [SECURITY_DECISIONS.STEP_UP, SECURITY_DECISIONS.DENY, SECURITY_DECISIONS.LOCKDOWN].includes(decision)) {
        return 'would_block';
    }
    if (decision === SECURITY_DECISIONS.LOCKDOWN) return 'blocked';
    if (decision === SECURITY_DECISIONS.DENY) return 'denied';
    if (decision === SECURITY_DECISIONS.STEP_UP) return 'step_up';
    if (decision === SECURITY_DECISIONS.AUDIT) return 'audit';
    return 'allowed';
};

const buildSecurityDecisionEvent = ({
    evaluation = {},
    config = resolveSecurityFabricConfig(),
} = {}) => {
    const context = evaluation.context || {};
    const decision = evaluation.decisionModel || {};

    return redactSecurityValue({
        eventType: EVENT_TYPE,
        action: evaluation.action || context.action || '',
        decision: evaluation.decision || decision.decision || SECURITY_DECISIONS.ALLOW,
        riskScore: evaluation.riskScore || decision.riskScore || 0,
        reasons: evaluation.reasons || decision.reasons || [],
        actorId: context.actorId || '',
        actorRole: context.actorRole || '',
        tenantId: context.tenantId || '',
        resourceType: context.resourceType || '',
        resourceId: context.resourceId || '',
        requestId: context.requestId || '',
        ipHash: context.ipHash || '',
        userAgentHash: context.userAgentHash || '',
        path: context.path || '',
        method: context.method || '',
        auditOnly: Boolean(config.auditOnly),
        createdAt: decision.createdAt || new Date().toISOString(),
    });
};

const logSecurityDecisionEvent = ({
    req = null,
    evaluation = {},
    config = resolveSecurityFabricConfig(),
} = {}) => {
    if (!config.eventLoggingEnabled || !evaluation.auditRequired) {
        return null;
    }

    const eventPayload = buildSecurityDecisionEvent({ evaluation, config });
    const result = resultFromDecision({
        decision: eventPayload.decision,
        auditOnly: eventPayload.auditOnly,
    });

    try {
        return recordSecurityAuditEvent({
            event: EVENT_TYPE,
            req,
            actorId: eventPayload.actorId,
            action: eventPayload.action,
            resourceType: eventPayload.resourceType,
            resourceId: eventPayload.resourceId,
            result,
            reasonCode: eventPayload.reasons.join(',').slice(0, 240),
            riskLevel: riskLevelFromScore(eventPayload.riskScore),
            meta: {
                ...eventPayload,
                eventType: EVENT_TYPE,
            },
            level: result === 'denied' || result === 'blocked' ? 'warn' : 'info',
        });
    } catch (error) {
        if (config.enforce && eventPayload.riskScore >= 80) {
            throw error;
        }
        return null;
    }
};

module.exports = {
    EVENT_TYPE,
    buildSecurityDecisionEvent,
    logSecurityDecisionEvent,
    resultFromDecision,
    riskLevelFromScore,
};

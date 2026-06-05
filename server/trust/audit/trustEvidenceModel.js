const { redactTrustValue } = require('./trustRedactor');

const buildTrustAuditEvent = ({ decision = {}, req = null, metadata = {} } = {}) => {
    const evidence = decision.evidence || {};
    return redactTrustValue({
        event: 'trust.fabric.decision',
        decisionId: evidence.decisionId || '',
        requestId: evidence.requestId || req?.requestId || req?.headers?.['x-request-id'] || '',
        actorId: evidence.actorId || req?.user?._id || '',
        actorRole: decision.metadata?.actorRole || req?.user?.role || '',
        action: evidence.action || '',
        resourceType: evidence.resourceType || '',
        resourceId: evidence.resourceId || '',
        route: evidence.route || req?.originalUrl || req?.url || '',
        method: req?.method || decision.metadata?.method || '',
        decision: decision.decision || '',
        reason: decision.reason || '',
        riskScore: decision.riskScore || 0,
        riskLevel: decision.riskLevel || 'low',
        enforcementMode: decision.enforcementMode || 'shadow',
        requiredStepUp: decision.requiredStepUp || null,
        timestamp: evidence.timestamp || new Date().toISOString(),
        metadata,
    });
};

module.exports = {
    buildTrustAuditEvent,
};

const logger = require('../../utils/logger');
const { recordSecurityAuditEvent } = require('../../services/securityAuditService');
const { buildTrustAuditEvent } = require('./trustEvidenceModel');

const recordTrustDecision = ({ req = null, decision = {}, metadata = {} } = {}) => {
    if (!decision.audit) return null;

    const auditEvent = buildTrustAuditEvent({ decision, req, metadata });
    try {
        recordSecurityAuditEvent({
            event: 'trust.fabric.decision',
            req,
            actorId: auditEvent.actorId,
            action: auditEvent.action,
            resourceType: auditEvent.resourceType,
            resourceId: auditEvent.resourceId,
            result: decision.allowed ? 'allowed' : 'denied',
            reasonCode: auditEvent.reason,
            riskLevel: auditEvent.riskLevel,
            meta: auditEvent,
            level: decision.allowed ? 'info' : 'warn',
        });
    } catch (error) {
        try {
            logger.warn('trust.audit_failed', {
                error: error?.message || 'unknown error',
                decisionId: decision.evidence?.decisionId || '',
            });
        } catch {
            // Audit failures must never change request behavior.
        }
    }

    return auditEvent;
};

module.exports = {
    recordTrustDecision,
};

const crypto = require('crypto');
const logger = require('../../utils/logger');
const { hashValue, safeHashId } = require('./redaction');

const normalizeRoute = (req = {}) => String(req.originalUrl || req.path || req.url || '')
    .split('?')[0]
    .replace(/[0-9a-f]{24}/gi, ':id')
    .replace(/[0-9a-f-]{36}/gi, ':uuid');

const buildAuditEvent = ({
    req = {},
    decision = {},
    identity = {},
    resource = {},
    risk = {},
    config = {},
} = {}) => ({
    event: 'authshield.decision',
    decision: decision.decision || '',
    action: decision.action || '',
    sensitivity: decision.sensitivity || '',
    riskLevel: risk.level || decision.riskLevel || '',
    riskReasons: Array.isArray(risk.reasons) ? risk.reasons.slice(0, 12) : [],
    policyVersion: config.policyVersion || decision.policyVersion || '',
    userIdHash: safeHashId(identity.userId || ''),
    resourceType: resource?.type || '',
    resourceIdHash: safeHashId(resource?.id || resource?._id || ''),
    tenantIdHash: safeHashId(resource?.tenantId || identity.tenantId || ''),
    requestId: decision.requestId || req.requestId || req.headers?.['x-request-id'] || '',
    route: normalizeRoute(req),
    method: String(req.method || '').toUpperCase(),
    ipHash: hashValue(req.ip || req.socket?.remoteAddress || req.headers?.['x-forwarded-for'] || ''),
    userAgentHash: hashValue(req.headers?.['user-agent'] || ''),
    shadowMode: Boolean(config.shadowMode),
    failClosed: Boolean(decision.failClosed),
    createdAt: new Date().toISOString(),
});

const writeDecisionAudit = async (input = {}) => {
    const config = input.config || {};
    if (!config.auditEnabled) {
        return { auditId: '' };
    }

    const auditId = crypto.randomUUID();
    const event = {
        auditId,
        ...buildAuditEvent(input),
    };
    const decision = String(event.decision || '');
    const level = decision === 'allow' ? 'info' : 'warn';

    logger[level]('authshield.decision', event);
    return { auditId, event };
};

module.exports = {
    buildAuditEvent,
    writeDecisionAudit,
};

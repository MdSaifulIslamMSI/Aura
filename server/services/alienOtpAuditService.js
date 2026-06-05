const crypto = require('crypto');
const logger = require('../utils/logger');
const { hashValue, safeHashId } = require('../security/authShield/redaction');

const ALIEN_AUDIT_EVENTS = Object.freeze({
    CHALLENGE_CREATED: 'alien.challenge.created',
    CHALLENGE_VERIFIED: 'alien.challenge.verified',
    CHALLENGE_FAILED: 'alien.challenge.failed',
    CHALLENGE_EXPIRED: 'alien.challenge.expired',
    CHALLENGE_REPLAYED: 'alien.challenge.replayed',
    CHALLENGE_CONSUMED: 'alien.challenge.consumed',
    AUTHZ_ALLOWED: 'alien.authz.allowed',
    AUTHZ_DENIED: 'alien.authz.denied',
    RISK_LOW: 'alien.risk.low',
    RISK_MEDIUM: 'alien.risk.medium',
    RISK_HIGH: 'alien.risk.high',
    RISK_CRITICAL: 'alien.risk.critical',
    DEVICE_BOUND: 'alien.device.bound',
    DEVICE_REJECTED: 'alien.device.rejected',
    STRICT_MODE_BLOCKED: 'alien.strict_mode.blocked',
    FALLBACK_USED: 'alien.fallback.used',
});

const normalizeRoute = (req = {}) => String(req.originalUrl || req.path || req.url || '')
    .split('?')[0]
    .replace(/[0-9a-f]{24}/gi, ':id')
    .replace(/[0-9a-f-]{36}/gi, ':uuid');

const redactReasons = (reasons = []) => (
    Array.isArray(reasons)
        ? reasons.map((reason) => String(reason || '').trim()).filter(Boolean).slice(0, 16)
        : []
);

const buildAlienAuditEvent = ({
    event = '',
    req = {},
    userId = '',
    deviceId = '',
    tenantId = '',
    action = '',
    resourceId = '',
    riskLevel = '',
    decision = '',
    reasons = [],
    challengeId = '',
    config = {},
} = {}) => ({
    auditId: crypto.randomUUID(),
    event,
    decision,
    action: String(action || '').trim(),
    tenantIdHash: safeHashId(tenantId || ''),
    userIdHash: safeHashId(userId || ''),
    resourceIdHash: safeHashId(resourceId || ''),
    deviceIdHash: safeHashId(deviceId || ''),
    challengeIdHash: safeHashId(challengeId || ''),
    riskLevel: String(riskLevel || '').trim().toLowerCase(),
    reasons: redactReasons(reasons),
    requestId: req.requestId || req.headers?.['x-request-id'] || '',
    route: normalizeRoute(req),
    method: String(req.method || '').toUpperCase(),
    ipHash: hashValue(req.ip || req.socket?.remoteAddress || req.headers?.['x-forwarded-for'] || ''),
    userAgentHash: hashValue(req.headers?.['user-agent'] || ''),
    strictMode: Boolean(config.strictMode),
    policyVersion: config.policyVersion || '',
    createdAt: new Date().toISOString(),
});

const writeAlienAuditEvent = async (input = {}) => {
    const config = input.config || {};
    if (config.auditEnabled === false) return { auditId: '', event: null };

    const event = buildAlienAuditEvent(input);
    const level = String(input.decision || '').includes('deny') || String(input.event || '').includes('failed')
        ? 'warn'
        : 'info';
    logger[level]('alien_otp.event', event);
    return { auditId: event.auditId, event };
};

module.exports = {
    ALIEN_AUDIT_EVENTS,
    buildAlienAuditEvent,
    writeAlienAuditEvent,
};

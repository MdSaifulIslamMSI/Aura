const logger = require('../utils/logger');
const { hashSecurityValue } = require('../security/redactSecurityMetadata');

const SECURITY_AUDIT_EVENTS = Object.freeze({
    AUTH_LOGIN_SUCCESS: 'auth.login.success',
    AUTH_LOGIN_FAILURE: 'auth.login.failure',
    AUTH_WEBAUTHN_STEP_UP_REQUIRED: 'auth.webauthn.step_up.required',
    AUTH_WEBAUTHN_STEP_UP_SUCCESS: 'auth.webauthn.step_up.success',
    AUTH_RECOVERY_STARTED: 'auth.recovery.started',
    AUTH_RECOVERY_COMPLETED: 'auth.recovery.completed',
    ADMIN_STATE_CHANGE_ALLOWED: 'admin.state_change.allowed',
    ADMIN_STATE_CHANGE_DENIED: 'admin.state_change.denied',
    PAYMENT_REFUND_ALLOWED: 'payment.refund.allowed',
    PAYMENT_REFUND_DENIED: 'payment.refund.denied',
    WEBHOOK_ACCEPTED: 'webhook.accepted',
    WEBHOOK_REPLAYED: 'webhook.replayed',
    WEBHOOK_SIGNATURE_INVALID: 'webhook.signature_invalid',
    UPLOAD_ACCEPTED: 'upload.accepted',
    UPLOAD_BLOCKED: 'upload.blocked',
    MODERATION_ACTION_ALLOWED: 'moderation.action.allowed',
    MODERATION_ACTION_DENIED: 'moderation.action.denied',
    SECURITY_POLICY_DENIED: 'security.policy.denied',
    DATA_EXPORT_REQUESTED: 'data.export.requested',
    DATA_DELETE_REQUESTED: 'data.delete.requested',
    AI_TOOL_ACTION_ALLOWED: 'ai.tool_action.allowed',
    AI_TOOL_ACTION_DENIED: 'ai.tool_action.denied',
});

const SENSITIVE_AUDIT_KEY_PATTERN = /(authorization|cookie|token|otp|password|secret|api[_-]?key|card|cvv|pan|rawbody|payload|private|credential|signature|proof)/i;
const AUDIT_IDENTIFIER_KEY_PATTERN = /^(actorId|resourceId|userId|uid|firebaseUid|authUid|accountId|ownerId|tenantId|sellerId|buyerId)$/i;
const HASHED_IDENTIFIER_PATTERN = /^[a-f0-9]{16}$/i;
const SENSITIVE_AUDIT_TEXT_PATTERN = /\b(sk_(?:live|test)_[A-Za-z0-9]+|whsec_[A-Za-z0-9]+|Bearer\s+[A-Za-z0-9._~+/=-]+)\b/g;

const hashValue = (value = '') => hashSecurityValue(value);

const redactAuditText = (value = '') => String(value || '').replace(SENSITIVE_AUDIT_TEXT_PATTERN, '[REDACTED]');

const truncateIp = (value = '') => {
    const ip = String(value || '').trim();
    if (!ip) return '';
    if (ip.includes(':')) return `${ip.split(':').slice(0, 3).join(':')}::/48`;
    return ip.split('.').slice(0, 3).join('.').concat('.0/24');
};

const redactAuditMeta = (value, key = '') => {
    if (value === null || value === undefined) return value;

    if (SENSITIVE_AUDIT_KEY_PATTERN.test(String(key || ''))) {
        return '[REDACTED]';
    }

    if (Array.isArray(value)) {
        return value.map((entry) => redactAuditMeta(entry, key));
    }

    if (value instanceof Date) {
        return value.toISOString();
    }

    if (typeof value === 'object') {
        return Object.entries(value).reduce((acc, [entryKey, entryValue]) => {
            acc[entryKey] = redactAuditMeta(entryValue, entryKey);
            return acc;
        }, {});
    }

    if (AUDIT_IDENTIFIER_KEY_PATTERN.test(String(key || ''))) {
        const normalizedValue = String(value || '').trim();
        if (!normalizedValue) return '';
        if (HASHED_IDENTIFIER_PATTERN.test(normalizedValue)) return normalizedValue;
        return hashSecurityValue(normalizedValue);
    }

    if (String(key || '').toLowerCase().includes('ip')) {
        return truncateIp(value);
    }

    if (String(key || '').toLowerCase().includes('useragent')) {
        return hashValue(value);
    }

    if (typeof value === 'string') {
        return redactAuditText(value);
    }

    return value;
};

const normalizeRequestPath = (req = {}) => String(req.originalUrl || req.path || '')
    .split('?')[0]
    .replace(/[0-9a-f]{24}/gi, ':id')
    .replace(/[0-9a-f-]{36}/gi, ':uuid');

const recordSecurityAuditEvent = ({
    event,
    req = null,
    actorId = '',
    action = '',
    resourceType = '',
    resourceId = '',
    result = '',
    reasonCode = '',
    riskLevel = '',
    meta = {},
    level = '',
} = {}) => {
    const payload = {
        event,
        timestamp: new Date().toISOString(),
        requestId: req?.requestId || req?.headers?.['x-request-id'] || '',
        actorId: String(actorId || req?.user?._id || req?.authSession?.userId || ''),
        action,
        resourceType,
        resourceId: String(resourceId || '').slice(0, 120),
        result,
        reasonCode,
        riskLevel,
        method: req?.method || '',
        path: normalizeRequestPath(req || {}),
        ip: req?.ip || req?.headers?.['x-forwarded-for'] || '',
        userAgent: req?.headers?.['user-agent'] || '',
        meta: redactAuditMeta(meta),
    };
    const safePayload = redactAuditMeta(payload);
    const resolvedLevel = ['debug', 'info', 'warn', 'error'].includes(String(level).toLowerCase())
        ? String(level).toLowerCase()
        : result === 'denied' || result === 'blocked'
            ? 'warn'
            : 'info';

    try {
        logger[resolvedLevel]('security.audit_event', safePayload);
    } catch {
        // Audit logging must not change request behavior.
    }

    return safePayload;
};

const eventForSensitiveActionDecision = (decision = {}) => {
    if (decision.category === 'PAYMENT_REFUND') {
        return decision.allowed
            ? SECURITY_AUDIT_EVENTS.PAYMENT_REFUND_ALLOWED
            : SECURITY_AUDIT_EVENTS.PAYMENT_REFUND_DENIED;
    }
    if (decision.category === 'UPLOAD_WRITE') {
        return decision.allowed
            ? SECURITY_AUDIT_EVENTS.UPLOAD_ACCEPTED
            : SECURITY_AUDIT_EVENTS.UPLOAD_BLOCKED;
    }
    if (decision.category === 'MODERATION_ACTION') {
        return decision.allowed
            ? SECURITY_AUDIT_EVENTS.MODERATION_ACTION_ALLOWED
            : SECURITY_AUDIT_EVENTS.MODERATION_ACTION_DENIED;
    }
    if (decision.category === 'AI_TOOL_ACTION') {
        return decision.allowed
            ? SECURITY_AUDIT_EVENTS.AI_TOOL_ACTION_ALLOWED
            : SECURITY_AUDIT_EVENTS.AI_TOOL_ACTION_DENIED;
    }
    if (decision.category === 'DATA_EXPORT') {
        return SECURITY_AUDIT_EVENTS.DATA_EXPORT_REQUESTED;
    }
    if (decision.category === 'DATA_DELETE') {
        return SECURITY_AUDIT_EVENTS.DATA_DELETE_REQUESTED;
    }
    if (!decision.allowed) {
        return SECURITY_AUDIT_EVENTS.SECURITY_POLICY_DENIED;
    }
    return decision.allowed
        ? SECURITY_AUDIT_EVENTS.ADMIN_STATE_CHANGE_ALLOWED
        : SECURITY_AUDIT_EVENTS.ADMIN_STATE_CHANGE_DENIED;
};

const recordSensitiveActionDecision = ({ req = null, decision = {}, meta = {} } = {}) => (
    recordSecurityAuditEvent({
        event: eventForSensitiveActionDecision(decision),
        req,
        actorId: decision.actorUserId,
        action: decision.action,
        resourceType: decision.resourceType,
        result: decision.allowed ? 'allowed' : 'denied',
        reasonCode: decision.reason,
        riskLevel: decision.riskLevel,
        meta: {
            category: decision.category,
            requiredAssurance: decision.requiredAssurance,
            telemetryCode: decision.telemetryCode,
            rollbackAllowed: decision.rollbackAllowed,
            ...meta,
        },
    })
);

module.exports = {
    SECURITY_AUDIT_EVENTS,
    eventForSensitiveActionDecision,
    hashValue,
    recordSecurityAuditEvent,
    recordSensitiveActionDecision,
    redactAuditMeta,
    truncateIp,
};

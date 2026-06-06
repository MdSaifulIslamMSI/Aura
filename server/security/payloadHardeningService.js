const AppError = require('../utils/AppError');
const { writeSecurityEvent } = require('./securityEventLogger');

const DANGEROUS_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

const isPlainObject = (value) => (
    value !== null
    && typeof value === 'object'
    && !Array.isArray(value)
    && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)
);

const findDangerousPayloadKeys = (value, path = '') => {
    if (!value || typeof value !== 'object') return [];
    const findings = [];
    const entries = Array.isArray(value)
        ? value.map((entry, index) => [String(index), entry])
        : Object.entries(value);

    for (const [key, entryValue] of entries) {
        const nextPath = path ? `${path}.${key}` : key;
        if (DANGEROUS_KEYS.has(String(key))) {
            findings.push(nextPath);
        }
        findings.push(...findDangerousPayloadKeys(entryValue, nextPath));
    }

    return findings;
};

const findUnknownPayloadFields = (payload = {}, allowedFields = []) => {
    const allowed = new Set(allowedFields);
    return Object.keys(payload || {}).filter((key) => !allowed.has(key));
};

const rejectPayload = ({ req = null, reason, fields = [], statusCode = 400 } = {}) => {
    writeSecurityEvent({
        event: 'payload.rejected',
        req,
        action: req?.securityAction || '',
        riskScore: 50,
        decision: 'DENY',
        reasonCode: reason,
        metadata: { fields },
    }, { level: 'warn' });

    const error = new AppError('Request payload failed security validation.', statusCode);
    error.code = String(reason || 'payload_rejected').toUpperCase();
    throw error;
};

const validateSensitiveJsonPayload = ({
    payload,
    allowedFields = [],
    req = null,
    rejectUnknownFields = true,
    requirePlainObject = true,
} = {}) => {
    if (requirePlainObject && !isPlainObject(payload)) {
        rejectPayload({ req, reason: 'payload_not_plain_object' });
    }

    const dangerousKeys = findDangerousPayloadKeys(payload);
    if (dangerousKeys.length) {
        rejectPayload({ req, reason: 'dangerous_payload_key', fields: dangerousKeys });
    }

    if (rejectUnknownFields && allowedFields.length) {
        const unknownFields = findUnknownPayloadFields(payload, allowedFields);
        if (unknownFields.length) {
            rejectPayload({ req, reason: 'unknown_payload_field', fields: unknownFields });
        }
    }

    return {
        ok: true,
        payload,
    };
};

module.exports = {
    DANGEROUS_KEYS,
    findDangerousPayloadKeys,
    findUnknownPayloadFields,
    isPlainObject,
    validateSensitiveJsonPayload,
};

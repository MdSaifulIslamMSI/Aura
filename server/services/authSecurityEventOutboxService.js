const crypto = require('crypto');
const AuthSecurityEventOutbox = require('../models/AuthSecurityEventOutbox');
const { getLoginRuntimeEnforcementPolicy } = require('../config/loginRuntimeEnforcementPolicy');
const logger = require('../utils/logger');

const safeString = (value, fallback = '') => String(value === undefined || value === null ? fallback : value).trim();

const isAuthSecurityOutboxEnabled = () => getLoginRuntimeEnforcementPolicy().authSecurityOutboxEnabled;

const buildAuthSecurityEventEnvelope = ({
    event = 'auth_event',
    outcome = 'success',
    reason = 'none',
    surface = 'auth',
    userId = '',
    requestId = '',
    occurredAt = new Date(),
    meta = {},
} = {}) => ({
    version: 1,
    topic: 'auth.security',
    eventId: crypto.randomUUID(),
    event: safeString(event, 'auth_event'),
    outcome: safeString(outcome, 'success'),
    reason: safeString(reason, 'none'),
    surface: safeString(surface, 'auth'),
    userId: safeString(userId),
    requestId: safeString(requestId),
    occurredAt: new Date(occurredAt).toISOString(),
    meta: meta && typeof meta === 'object' && !Array.isArray(meta)
        ? logger.redactSensitiveData(meta)
        : {},
});

const enqueueAuthSecurityEvent = async (eventPayload = {}) => {
    if (!isAuthSecurityOutboxEnabled()) {
        return { enabled: false, enqueued: false };
    }

    const envelope = buildAuthSecurityEventEnvelope(eventPayload);
    try {
        const record = await AuthSecurityEventOutbox.create({
            eventId: envelope.eventId,
            topic: envelope.topic,
            payload: envelope,
            status: 'pending',
        });
        return { enabled: true, enqueued: true, eventId: record.eventId };
    } catch (error) {
        logger.warn('auth.security_outbox_enqueue_failed', {
            event: safeString(eventPayload.event),
            surface: safeString(eventPayload.surface),
            error: error?.message || 'unknown',
        });
        return { enabled: true, enqueued: false, error: error?.message || 'unknown' };
    }
};

module.exports = {
    buildAuthSecurityEventEnvelope,
    enqueueAuthSecurityEvent,
    isAuthSecurityOutboxEnabled,
};

const logger = require('../utils/logger');
const {
    hashSecurityValue,
    redactSecurityMetadata,
} = require('./redactSecurityMetadata');

const bufferedEvents = [];
const MAX_BUFFERED_EVENTS = 200;

const safeId = (value = '') => {
    const text = String(value || '').trim();
    if (!text) return '';
    if (/^[a-zA-Z0-9_-]{1,64}$/.test(text)) return text;
    return hashSecurityValue(text);
};

const buildSecurityEvent = ({
    event,
    req = null,
    requestId = '',
    userId = '',
    tenantId = '',
    action = '',
    route = '',
    method = '',
    ipHash = '',
    userAgentHash = '',
    riskScore = 0,
    decision = '',
    reasonCode = '',
    environment = process.env.NODE_ENV || 'development',
    metadata = {},
} = {}) => ({
    event,
    timestamp: new Date().toISOString(),
    requestId: requestId || req?.requestId || req?.headers?.['x-request-id'] || '',
    userId: safeId(userId || req?.user?._id || req?.authSession?.userId || ''),
    tenantId: safeId(tenantId || req?.user?.tenantId || ''),
    action,
    route: route || req?.originalUrl || req?.path || '',
    method: method || req?.method || '',
    ipHash: ipHash || hashSecurityValue(req?.ip || req?.headers?.['x-forwarded-for'] || ''),
    userAgentHash: userAgentHash || hashSecurityValue(req?.headers?.['user-agent'] || ''),
    riskScore: Number(riskScore) || 0,
    decision,
    reasonCode,
    environment,
    metadata: redactSecurityMetadata(metadata),
});

const writeSecurityEvent = (payload = {}, options = {}) => {
    const event = buildSecurityEvent(payload);
    bufferedEvents.push(event);
    if (bufferedEvents.length > MAX_BUFFERED_EVENTS) {
        bufferedEvents.splice(0, bufferedEvents.length - MAX_BUFFERED_EVENTS);
    }

    const logLevel = options.level || (
        ['DENY', 'CONTAIN', 'THROTTLE'].includes(String(event.decision || '').toUpperCase())
            ? 'warn'
            : 'info'
    );

    try {
        const writer = typeof logger[logLevel] === 'function' ? logger[logLevel] : logger.info;
        writer('security.event', event);
    } catch {
        // Security event logging must not change the request outcome.
    }

    return event;
};

module.exports = {
    buildSecurityEvent,
    writeSecurityEvent,
    __getBufferedEvents: () => bufferedEvents.slice(),
    __resetBufferedEvents: () => bufferedEvents.splice(0, bufferedEvents.length),
};

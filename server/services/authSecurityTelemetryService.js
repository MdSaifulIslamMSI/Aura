const client = require('prom-client');
const { registry } = require('../middleware/metrics');
const logger = require('../utils/logger');
const { enqueueAuthSecurityEvent } = require('./authSecurityEventOutboxService');

const METRIC_NAME = 'aura_auth_security_events_total';
const OUTCOMES = new Set(['success', 'failure', 'blocked', 'required', 'issued']);
const SURFACES = new Set([
    'auth',
    'otp',
    'csrf',
    'admin',
    'trusted_device',
    'recovery',
    'payment',
    'webhook',
    'upload',
    'moderation',
    'policy',
    'data',
    'ai',
]);
const REASON_ALIASES = [
    ['already_used', ['already used', 'replay']],
    ['allowlist', ['allowlist']],
    ['denied', ['denied', 'unauthorized', 'not authorized', 'forbidden']],
    ['expired', ['expired', 'stale']],
    ['invalid', ['invalid', 'malformed', 'token failed', 'session failed']],
    ['locked', ['locked', 'lockout']],
    ['mismatch', ['mismatch']],
    ['missing', ['missing', 'no session', 'no token']],
    ['not_found', ['not found', 'missing profile']],
    ['second_factor', ['second factor', '2fa', 'otp']],
    ['webauthn', ['webauthn']],
    ['passkey', ['passkey']],
    ['recent_auth', ['recent auth', 'fresh login', 'fresh re-auth', 'reauthentication']],
    ['break_glass', ['break glass']],
    ['required', ['required']],
    ['revoked', ['revoked', 'revocation']],
    ['unavailable', ['unavailable', 'down', 'failed dependency', 'cleanup pending']],
    ['unverified', ['unverified']],
];

const sanitizeLabel = (value, fallback = 'unknown') => {
    const normalized = String(value || '')
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9_.:-]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .slice(0, 80);
    return normalized || fallback;
};

const normalizeOutcome = (value) => {
    const normalized = sanitizeLabel(value, 'success');
    return OUTCOMES.has(normalized) ? normalized : 'failure';
};

const normalizeSurface = (value) => {
    const normalized = sanitizeLabel(value, 'auth');
    return SURFACES.has(normalized) ? normalized : 'auth';
};

const normalizeReason = (value) => {
    const raw = String(value || '').trim();
    if (!raw) return 'none';

    const normalized = raw.toLowerCase().replace(/[_-]+/g, ' ');
    if (normalized === 'none') return 'none';
    const alias = REASON_ALIASES.find(([, needles]) => (
        needles.some((needle) => normalized.includes(needle))
    ));
    if (alias) return alias[0];

    return 'other';
};

const normalizePathForLog = (req = {}) => {
    const rawPath = String(req.originalUrl || req.path || '').split('?')[0] || '';
    return rawPath
        .split('/')
        .map((segment) => {
            if (/^[0-9a-f]{24}$/i.test(segment)) return ':id';
            if (/^[0-9a-f-]{36}$/i.test(segment)) return ':uuid';
            if (/^\d+$/.test(segment)) return ':num';
            return segment;
        })
        .join('/') || '';
};

const getCounter = () => (
    registry.getSingleMetric(METRIC_NAME)
    || new client.Counter({
        name: METRIC_NAME,
        help: 'Total authentication security events by bounded event, outcome, reason, and surface.',
        labelNames: ['event', 'outcome', 'reason', 'surface'],
        registers: [registry],
    })
);

const chooseLogLevel = (outcome, explicitLevel = '') => {
    const level = String(explicitLevel || '').trim().toLowerCase();
    if (['debug', 'info', 'warn', 'error'].includes(level)) return level;
    if (outcome === 'success' || outcome === 'issued') return 'info';
    return 'warn';
};

const recordAuthSecurityEvent = ({
    event,
    outcome = 'success',
    reason = '',
    surface = 'auth',
    req = null,
    level = '',
    meta = {},
} = {}) => {
    const labels = {
        event: sanitizeLabel(event, 'auth_event'),
        outcome: normalizeOutcome(outcome),
        reason: normalizeReason(reason),
        surface: normalizeSurface(surface),
    };

    try {
        getCounter().inc(labels);
    } catch (error) {
        logger.debug('auth.security_event_metric_failed', { error: error?.message || 'unknown' });
    }

    const logLevel = chooseLogLevel(labels.outcome, level);
    try {
        logger[logLevel]('auth.security_event', {
            ...labels,
            requestId: req?.requestId || req?.headers?.['x-request-id'] || '',
            method: req?.method || '',
            path: normalizePathForLog(req || {}),
            statusCode: meta.statusCode || undefined,
            ...meta,
        });
    } catch {
        // Telemetry must never change authentication behavior.
    }

    enqueueAuthSecurityEvent({
        ...labels,
        requestId: req?.requestId || req?.headers?.['x-request-id'] || '',
        userId: meta.userId || req?.user?._id || req?.authSession?.userId || '',
        meta,
    }).catch((error) => {
        logger.debug('auth.security_event_outbox_failed', { error: error?.message || 'unknown' });
    });
};

module.exports = {
    METRIC_NAME,
    recordAuthSecurityEvent,
    __private: {
        normalizeReason,
        sanitizeLabel,
    },
};

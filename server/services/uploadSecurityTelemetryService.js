const client = require('prom-client');
const { registry } = require('../middleware/metrics');
const logger = require('../utils/logger');

const METRIC_NAME = 'aura_upload_security_events_total';
const OUTCOMES = new Set(['blocked', 'failure', 'clean', 'skipped']);
const REASONS = new Set([
    'empty',
    'invalid_data_uri',
    'magic_mismatch',
    'mime_mismatch',
    'malware_blocked',
    'malware_scan_unavailable',
    'missing_extension',
    'oversized',
    'unsafe_filename',
    'unsupported_extension',
    'unsupported_mime',
]);

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
    const normalized = sanitizeLabel(value, 'blocked');
    return OUTCOMES.has(normalized) ? normalized : 'failure';
};

const normalizeReason = (value) => {
    const normalized = sanitizeLabel(value, 'other');
    return REASONS.has(normalized) ? normalized : 'other';
};

const normalizeEvent = normalizeReason;

const getCounter = () => (
    registry.getSingleMetric(METRIC_NAME)
    || new client.Counter({
        name: METRIC_NAME,
        help: 'Total upload security events by bounded event, outcome, reason, and purpose.',
        labelNames: ['event', 'outcome', 'reason', 'purpose'],
        registers: [registry],
    })
);

const chooseLogLevel = (outcome, explicitLevel = '') => {
    const level = String(explicitLevel || '').trim().toLowerCase();
    if (['debug', 'info', 'warn', 'error'].includes(level)) return level;
    return outcome === 'failure' ? 'error' : 'warn';
};

const recordUploadSecurityEvent = ({
    event,
    outcome = 'blocked',
    reason = '',
    purpose = '',
    level = '',
    meta = {},
} = {}) => {
    const labels = {
        event: normalizeEvent(event),
        outcome: normalizeOutcome(outcome),
        reason: normalizeReason(reason || event),
        purpose: sanitizeLabel(purpose, 'upload'),
    };

    try {
        getCounter().inc(labels);
    } catch (error) {
        logger.debug('upload.security_event_metric_failed', { error: error?.message || 'unknown' });
    }

    try {
        const logLevel = chooseLogLevel(labels.outcome, level);
        logger[logLevel]('upload.security_event', {
            ...labels,
            ...meta,
        });
    } catch {
        // Upload telemetry must never change upload behavior.
    }
};

module.exports = {
    METRIC_NAME,
    recordUploadSecurityEvent,
    __private: {
        normalizeEvent,
        normalizeReason,
        sanitizeLabel,
    },
};

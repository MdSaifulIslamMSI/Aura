const mongoose = require('mongoose');
const ClientDiagnostic = require('../models/ClientDiagnostic');
const logger = require('../utils/logger');

const MAX_DIAGNOSTICS_PER_REQUEST = 20;
const MAX_RECENT_DIAGNOSTICS = 200;
const DEFAULT_LIST_LIMIT = 25;
const MAX_LIST_LIMIT = 100;
const REDACTED = '[REDACTED]';
const SENSITIVE_DIAGNOSTIC_KEY_PATTERN = /(authorization|cookie|set-cookie|token|otp|password|secret|api[_-]?key|apikey|card|cvv|pan|private|rawbody|payload|signature|credential|proof|session)/i;
const SENSITIVE_DIAGNOSTIC_TEXT_PATTERN = /\b(sk_(?:live|test)_[A-Za-z0-9]+|whsec_[A-Za-z0-9]+|Bearer\s+[A-Za-z0-9._~+/=-]+|(?:pi|seti|cs)_[A-Za-z0-9]+_secret_[A-Za-z0-9]+)\b/g;
const SENSITIVE_QUERY_PARAM_PATTERN = /([?&](?:access_token|auth|authorization|code|cookie|id_token|password|refresh_token|secret|session|token|api_key|apikey)=)[^&#\s]+/gi;

const recentDiagnostics = [];

const truncateString = (value = '', maxLength = 400) => {
    const normalized = String(value || '');
    return normalized.length > maxLength
        ? `${normalized.slice(0, maxLength - 3)}...`
        : normalized;
};

const redactDiagnosticText = (value = '') => String(value || '')
    .replace(SENSITIVE_DIAGNOSTIC_TEXT_PATTERN, REDACTED)
    .replace(SENSITIVE_QUERY_PARAM_PATTERN, `$1${REDACTED}`);

const sanitizeDiagnosticString = (value = '', maxLength = 400) => truncateString(redactDiagnosticText(value), maxLength);

const sanitizeValue = (value, depth = 0) => {
    if (depth > 2) {
        return undefined;
    }

    if (Array.isArray(value)) {
        return value.slice(0, 8).map((entry) => sanitizeValue(entry, depth + 1));
    }

    if (value && typeof value === 'object') {
        return Object.fromEntries(
            Object.entries(value)
                .slice(0, 12)
                .map(([key, entryValue]) => {
                    if (SENSITIVE_DIAGNOSTIC_KEY_PATTERN.test(String(key || ''))) {
                        return [key, REDACTED];
                    }
                    return [key, sanitizeValue(entryValue, depth + 1)];
                })
                .filter(([, entryValue]) => entryValue !== undefined)
        );
    }

    if (typeof value === 'string') {
        return truncateString(redactDiagnosticText(value), depth === 0 ? 400 : 240);
    }

    return value;
};

const normalizeDiagnostic = (event = {}, context = {}) => ({
    eventId: sanitizeDiagnosticString(event.id || '', 120),
    type: sanitizeDiagnosticString(event.type || 'unknown', 120),
    severity: sanitizeDiagnosticString(event.severity || 'info', 32),
    timestamp: (() => {
        const parsed = new Date(event.timestamp || new Date().toISOString());
        return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
    })(),
    route: sanitizeDiagnosticString(event.route || context.clientRoute || '', 200),
    sessionId: truncateString(event.sessionId || context.clientSessionId || '', 120),
    requestId: sanitizeDiagnosticString(event.requestId || '', 120),
    serverRequestId: sanitizeDiagnosticString(event.serverRequestId || '', 120),
    method: truncateString(event.method || '', 16),
    url: sanitizeDiagnosticString(event.url || '', 500),
    detail: sanitizeDiagnosticString(event.detail || '', 240),
    status: Number.isFinite(Number(event.status)) ? Number(event.status) : undefined,
    durationMs: Number.isFinite(Number(event.durationMs)) ? Number(event.durationMs) : undefined,
    error: sanitizeValue(event.error),
    context: sanitizeValue(event.context),
    ingestionRequestId: sanitizeDiagnosticString(context.ingestionRequestId || '', 120),
    clientIp: truncateString(context.clientIp || '', 120),
    userAgent: truncateString(context.userAgent || '', 240),
    ingestedAt: new Date(),
});

const persistClientDiagnostics = async ({
    events = [],
    ingestionRequestId = '',
    clientSessionId = '',
    clientRoute = '',
    clientIp = '',
    userAgent = '',
}) => {
    const context = {
        ingestionRequestId,
        clientSessionId,
        clientRoute,
        clientIp,
        userAgent,
    };

    const acceptedDiagnostics = events
        .slice(0, MAX_DIAGNOSTICS_PER_REQUEST)
        .map((event) => normalizeDiagnostic(event, context));

    acceptedDiagnostics.forEach((diagnostic) => {
        recentDiagnostics.push(diagnostic);
        if (recentDiagnostics.length > MAX_RECENT_DIAGNOSTICS) {
            recentDiagnostics.shift();
        }

        logger.warn('client.diagnostic', diagnostic);
    });

    let persistedCount = 0;
    let persistenceMode = 'memory';

    if (acceptedDiagnostics.length > 0 && mongoose.connection.readyState === 1) {
        try {
            await ClientDiagnostic.insertMany(acceptedDiagnostics, { ordered: false });
            persistedCount = acceptedDiagnostics.length;
            persistenceMode = 'mongo';
        } catch (error) {
            logger.warn('client.diagnostic.persist_failed', {
                error: error.message,
                accepted: acceptedDiagnostics.length,
                ingestionRequestId,
            });
            persistenceMode = 'memory';
        }
    }

    return {
        acceptedDiagnostics,
        acceptedCount: acceptedDiagnostics.length,
        persistedCount,
        persistenceMode,
    };
};

const getRecentClientDiagnostics = (limit = 25) => {
    const normalizedLimit = Math.max(1, Math.min(Number(limit) || 25, MAX_RECENT_DIAGNOSTICS));
    return recentDiagnostics.slice(-normalizedLimit).reverse();
};

const listClientDiagnostics = async ({
    limit = DEFAULT_LIST_LIMIT,
    type = '',
    severity = '',
    sessionId = '',
    requestId = '',
    route = '',
} = {}) => {
    const normalizedLimit = Math.max(1, Math.min(Number(limit) || DEFAULT_LIST_LIMIT, MAX_LIST_LIMIT));

    const applyMemoryFilters = (items = []) => items.filter((diagnostic) => {
        if (type && diagnostic.type !== type) return false;
        if (severity && diagnostic.severity !== severity) return false;
        if (sessionId && diagnostic.sessionId !== sessionId) return false;
        if (requestId && diagnostic.requestId !== requestId && diagnostic.serverRequestId !== requestId) return false;
        if (route && !String(diagnostic.route || '').includes(route)) return false;
        return true;
    });

    if (mongoose.connection.readyState !== 1) {
        return {
            diagnostics: applyMemoryFilters(getRecentClientDiagnostics(normalizedLimit)).slice(0, normalizedLimit),
            source: 'memory',
        };
    }

    const query = {};
    if (type) query.type = type;
    if (severity) query.severity = severity;
    if (sessionId) query.sessionId = sessionId;
    if (requestId) {
        query.$or = [
            { requestId },
            { serverRequestId: requestId },
            { ingestionRequestId: requestId },
        ];
    }
    if (route) {
        query.route = { $regex: route, $options: 'i' };
    }

    try {
        const diagnostics = await ClientDiagnostic.find(query)
            .sort({ ingestedAt: -1 })
            .limit(normalizedLimit)
            .lean();

        return {
            diagnostics,
            source: 'mongo',
        };
    } catch (error) {
        logger.warn('client.diagnostic.query_failed', {
            error: error.message,
            requestId,
            sessionId,
            type,
        });

        return {
            diagnostics: applyMemoryFilters(getRecentClientDiagnostics(normalizedLimit)).slice(0, normalizedLimit),
            source: 'memory',
        };
    }
};

module.exports = {
    MAX_DIAGNOSTICS_PER_REQUEST,
    getRecentClientDiagnostics,
    listClientDiagnostics,
    persistClientDiagnostics,
};

const mongoose = require('mongoose');
const ClientDiagnostic = require('../models/ClientDiagnostic');
const logger = require('../utils/logger');

const MAX_DIAGNOSTICS_PER_REQUEST = 20;
const MAX_RECENT_DIAGNOSTICS = 200;
const DEFAULT_LIST_LIMIT = 25;
const MAX_LIST_LIMIT = 100;

const recentDiagnostics = [];

const truncateString = (value = '', maxLength = 400) => {
    const normalized = String(value || '');
    return normalized.length > maxLength
        ? `${normalized.slice(0, maxLength - 3)}...`
        : normalized;
};

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
                .map(([key, entryValue]) => [key, sanitizeValue(entryValue, depth + 1)])
                .filter(([, entryValue]) => entryValue !== undefined)
        );
    }

    if (typeof value === 'string') {
        return truncateString(value, depth === 0 ? 400 : 240);
    }

    return value;
};

const normalizeDiagnostic = (event = {}, context = {}) => ({
    eventId: truncateString(event.id || '', 120),
    type: truncateString(event.type || 'unknown', 120),
    severity: truncateString(event.severity || 'info', 32),
    timestamp: (() => {
        const parsed = new Date(event.timestamp || new Date().toISOString());
        return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
    })(),
    route: truncateString(event.route || context.clientRoute || '', 200),
    sessionId: truncateString(event.sessionId || context.clientSessionId || '', 120),
    requestId: truncateString(event.requestId || '', 120),
    serverRequestId: truncateString(event.serverRequestId || '', 120),
    method: truncateString(event.method || '', 16),
    url: truncateString(event.url || '', 500),
    detail: truncateString(event.detail || '', 240),
    status: Number.isFinite(Number(event.status)) ? Number(event.status) : undefined,
    durationMs: Number.isFinite(Number(event.durationMs)) ? Number(event.durationMs) : undefined,
    error: sanitizeValue(event.error),
    context: sanitizeValue(event.context),
    ingestionRequestId: truncateString(context.ingestionRequestId || '', 120),
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

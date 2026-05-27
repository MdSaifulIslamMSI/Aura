/**
 * metrics.js — Prometheus metrics middleware
 *
 * Exposes HTTP request duration histograms, active request gauges,
 * and error counters for scraping by Prometheus / Grafana / any
 * OpenMetrics-compatible collector.
 *
 * Usage: app.use(metricsMiddleware) before route handlers.
 * Scrape: GET /metrics (see metricsRoute.js)
 */

const crypto = require('crypto');
const client = require('prom-client');

// Use a dedicated registry so tests can reset it cleanly
const registry = new client.Registry();

// Default Node.js process metrics (GC, event loop lag, memory, etc.)
client.collectDefaultMetrics({ register: registry, prefix: 'aura_' });

// ── Custom metrics ─────────────────────────────────────────────────────────

const httpRequestDuration = new client.Histogram({
    name: 'aura_http_request_duration_seconds',
    help: 'Duration of HTTP requests in seconds',
    labelNames: ['method', 'route', 'status_code'],
    buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
    registers: [registry],
});

const httpRequestsTotal = new client.Counter({
    name: 'aura_http_requests_total',
    help: 'Total number of HTTP requests',
    labelNames: ['method', 'route', 'status_code'],
    registers: [registry],
});

const httpActiveRequests = new client.Gauge({
    name: 'aura_http_active_requests',
    help: 'Number of HTTP requests currently in flight',
    registers: [registry],
});

const httpErrorsTotal = new client.Counter({
    name: 'aura_http_errors_total',
    help: 'Total number of HTTP 5xx server errors',
    labelNames: ['method', 'route'],
    registers: [registry],
});

const httpRequestDurationStandard = new client.Histogram({
    name: 'http_request_duration_seconds',
    help: 'Duration of HTTP requests in seconds',
    labelNames: ['method', 'route', 'status_code'],
    buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
    registers: [registry],
});

const httpRequestsTotalStandard = new client.Counter({
    name: 'http_requests_total',
    help: 'Total number of HTTP requests',
    labelNames: ['method', 'route', 'status_code'],
    registers: [registry],
});

const cacheHitsTotal = new client.Counter({
    name: 'cache_hits_total',
    help: 'Total number of public response cache hits',
    labelNames: ['route'],
    registers: [registry],
});

const cacheMissesTotal = new client.Counter({
    name: 'cache_misses_total',
    help: 'Total number of public response cache misses',
    labelNames: ['route'],
    registers: [registry],
});

const cacheBypassTotal = new client.Counter({
    name: 'cache_bypass_total',
    help: 'Total number of cache bypass decisions',
    labelNames: ['reason'],
    registers: [registry],
});

const cacheErrorsTotal = new client.Counter({
    name: 'cache_errors_total',
    help: 'Total number of public response cache errors',
    labelNames: ['reason'],
    registers: [registry],
});

const dbQueryDurationSeconds = new client.Histogram({
    name: 'db_query_duration_seconds',
    help: 'Duration of DB queries when instrumented by call sites',
    labelNames: ['operation'],
    buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
    registers: [registry],
});

const statusComponentState = new client.Gauge({
    name: 'status_component_state',
    help: 'Status component state by component slug and state. Value is 1 for current state.',
    labelNames: ['component', 'status'],
    registers: [registry],
});

const statusIncidentsActive = new client.Gauge({
    name: 'status_incidents_active',
    help: 'Number of active status incidents.',
    registers: [registry],
});

const statusMonitorFailuresTotal = new client.Counter({
    name: 'status_monitor_failures_total',
    help: 'Total monitor failures ingested by status source.',
    labelNames: ['component', 'source'],
    registers: [registry],
});

const statusPublicPageRenderMs = new client.Gauge({
    name: 'status_public_page_render_ms',
    help: 'Last public status payload render duration in milliseconds.',
    registers: [registry],
});

const statusSubscriberNotificationsTotal = new client.Counter({
    name: 'status_subscriber_notifications_total',
    help: 'Subscriber notification outbox events by event type and result status.',
    labelNames: ['event_type', 'status'],
    registers: [registry],
});

const setStatusComponentMetric = ({ component = 'unknown', status = 'unknown', knownStatuses = [] } = {}) => {
    const statuses = knownStatuses.length ? knownStatuses : [
        'operational',
        'degraded',
        'degraded_performance',
        'partial_outage',
        'major_outage',
        'maintenance',
    ];
    statuses.forEach((entry) => {
        statusComponentState.set({ component, status: entry }, entry === status ? 1 : 0);
    });
};

const setStatusIncidentsActive = (count = 0) => {
    statusIncidentsActive.set(Number(count || 0));
};

const incrementStatusMonitorFailure = ({ component = 'unknown', source = 'unknown' } = {}) => {
    statusMonitorFailuresTotal.inc({ component, source });
};

const setStatusPublicPageRenderMs = (durationMs = 0) => {
    statusPublicPageRenderMs.set(Number(durationMs || 0));
};

const incrementStatusSubscriberNotification = ({ eventType = 'unknown', status = 'queued' } = {}) => {
    statusSubscriberNotificationsTotal.inc({ event_type: eventType, status });
};

// ── Route normaliser ───────────────────────────────────────────────────────
// Collapse dynamic path segments (ObjectIDs, UUIDs) into placeholders so the
// histogram doesn't explode with a new label per product ID.
const MONGO_ID = /^[0-9a-fA-F]{24}$/;
const UUID = /^[0-9a-fA-F-]{36}$/;

const normalizeRoute = (path = '') =>
    path
        .split('/')
        .map((segment) => {
            if (MONGO_ID.test(segment)) return ':id';
            if (UUID.test(segment)) return ':uuid';
            if (/^\d+$/.test(segment)) return ':num';
            return segment;
        })
        .join('/') || '/';

// ── Middleware ─────────────────────────────────────────────────────────────
const metricsMiddleware = (req, res, next) => {
    const start = process.hrtime.bigint();
    httpActiveRequests.inc();

    res.on('finish', () => {
        const durationSeconds = Number(process.hrtime.bigint() - start) / 1e9;
        const route = normalizeRoute(req.route?.path || req.path);
        const labels = {
            method: req.method,
            route,
            status_code: String(res.statusCode),
        };

        httpRequestDuration.observe(labels, durationSeconds);
        httpRequestsTotal.inc(labels);
        httpRequestDurationStandard.observe(labels, durationSeconds);
        httpRequestsTotalStandard.inc(labels);
        httpActiveRequests.dec();

        if (res.statusCode >= 500) {
            httpErrorsTotal.inc({ method: req.method, route });
        }
    });

    next();
};

const recordCacheHit = ({ route = 'unknown' } = {}) => {
    cacheHitsTotal.inc({ route });
};

const recordCacheMiss = ({ route = 'unknown' } = {}) => {
    cacheMissesTotal.inc({ route });
};

const recordCacheBypass = ({ reason = 'unknown' } = {}) => {
    cacheBypassTotal.inc({ reason });
};

const recordCacheError = ({ reason = 'unknown' } = {}) => {
    cacheErrorsTotal.inc({ reason });
};

const observeDbQueryDuration = ({ operation = 'unknown', durationSeconds = 0 } = {}) => {
    dbQueryDurationSeconds.observe({ operation }, Number(durationSeconds || 0));
};

const safeEqual = (left, right) => {
    const leftBuffer = Buffer.from(String(left || ''), 'utf8');
    const rightBuffer = Buffer.from(String(right || ''), 'utf8');

    if (leftBuffer.length !== rightBuffer.length) {
        return false;
    }

    return crypto.timingSafeEqual(leftBuffer, rightBuffer);
};

const metricsAuth = (req, res, next) => {
    const isProduction = (process.env.NODE_ENV || 'production') === 'production';
    const metricsSecret = String(process.env.METRICS_SECRET || process.env.CRON_SECRET || '').trim();

    if (!isProduction) {
        return next();
    }

    if (!metricsSecret) {
        return res.status(503).json({
            status: 'error',
            message: 'Metrics authentication is not configured',
        });
    }

    const authorization = String(req.headers.authorization || '').trim();
    const bearerMatch = authorization.match(/^Bearer\s+(.+)$/i);
    const provided = String(
        req.headers['x-metrics-key']
        || req.headers['x-metrics-token']
        || bearerMatch?.[1]
        || '',
    ).trim();

    if (!provided || !safeEqual(provided, metricsSecret)) {
        return res.status(401).json({ status: 'error', message: 'Unauthorized' });
    }

    return next();
};

module.exports = {
    incrementStatusMonitorFailure,
    incrementStatusSubscriberNotification,
    metricsMiddleware,
    metricsAuth,
    observeDbQueryDuration,
    recordCacheBypass,
    recordCacheError,
    recordCacheHit,
    recordCacheMiss,
    registry,
    setStatusComponentMetric,
    setStatusIncidentsActive,
    setStatusPublicPageRenderMs,
};

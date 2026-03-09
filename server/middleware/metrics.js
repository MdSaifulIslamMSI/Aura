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
        httpActiveRequests.dec();

        if (res.statusCode >= 500) {
            httpErrorsTotal.inc({ method: req.method, route });
        }
    });

    next();
};

module.exports = { metricsMiddleware, registry };

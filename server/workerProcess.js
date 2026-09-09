/**
 * workerProcess.js
 *
 * Standalone worker process entrypoint — runs separately from the HTTP server.
 *
 * WHY SEPARATE:
 * Previously all background workers (payment outbox, email queue, catalog sync,
 * analytics monitor, commerce reconciliation) started inside the HTTP server
 * process. A crash or OOM during peak traffic would atomically kill both the
 * API and all workers, meaning in-flight payment outbox jobs would stall until
 * the next restart.
 *
 * Running workers in a separate process means:
 *   - A spike that kills the HTTP server does NOT kill payment/email workers
 *   - Workers can be scaled and restarted independently
 *   - Logs and crash reports are isolated by process
 *
 * USAGE:
 *   npm run start:workers           (standalone worker process)
 *   npm start                       (HTTP API only, no workers)
 *
 * In production (Render, Railway, Fly.io): run as a separate service
 * pointing to the same DB + Redis.
 */

const dns = require('dns');
dns.setDefaultResultOrder('ipv4first');

const http = require('http');
const { loadLocalEnvFiles } = require('./config/runtimeConfig');

loadLocalEnvFiles();

require('colors');
const logger = require('./utils/logger');
const connectDB = require('./config/db');
const { initRedis, assertProductionRedisConfig } = require('./config/redis');
const { assertProductionPaymentConfig, assertWebhookConfig } = require('./config/paymentFlags');
const { assertProductionEmailConfig } = require('./config/emailFlags');
const { assertProductionOtpSmsConfig } = require('./config/otpSmsFlags');
const {
    startPaymentOutboxWorker,
    stopPaymentOutboxWorker,
} = require('./services/payments/paymentService');
const {
    startOrderEmailWorker,
} = require('./services/email/orderEmailQueueService');
const {
    startCommerceReconciliationWorker,
} = require('./services/commerceReconciliationService');
const { startAdminAnalyticsMonitor, stopAdminAnalyticsMonitor } = require('./services/adminAnalyticsMonitorService');
const { startEmailOpsMonitor, stopEmailOpsMonitor } = require('./services/email/emailOpsMonitorService');
const { startStatusMonitorWorker } = require('./services/statusService');
const {
    startCatalogWorkers,
    ensureSystemState,
    enforceCatalogStartupCheck,
} = require('./services/catalogService');
const { IntelligenceTaskMonitor } = require('./services/marketingIntelligenceService');
const { startOtpSignupMaintenanceWorker } = require('./services/otpSignupMaintenanceService');
const { syncCriticalIndexes } = require('./services/indexIntegrityService');

const NODE_ENV = process.env.NODE_ENV || 'production';
const HEALTH_PORT = Number(process.env.WORKER_HEALTH_PORT || process.env.PORT || 8080);
const workerRuntimeState = {
    ready: false,
    startupError: '',
    startedAt: new Date().toISOString(),
    readyAt: null,
    failedAt: null,
};

const createWorkerHealthServer = () => http.createServer((req, res) => {
    const payload = {
        uptime: process.uptime(),
        timestamp: new Date().toISOString(),
        worker: {
            ready: workerRuntimeState.ready,
            startupError: workerRuntimeState.startupError || null,
            startedAt: workerRuntimeState.startedAt,
            readyAt: workerRuntimeState.readyAt,
            failedAt: workerRuntimeState.failedAt,
        },
    };

    if (req.url === '/health/live') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            alive: true,
            ...payload,
        }));
        return;
    }

    if (req.url === '/health' || req.url === '/health/ready') {
        const statusCode = workerRuntimeState.ready ? 200 : 503;
        res.writeHead(statusCode, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            ready: workerRuntimeState.ready,
            ...payload,
        }));
        return;
    }

    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'not_found' }));
});

const healthServer = createWorkerHealthServer();
healthServer.listen(HEALTH_PORT, '0.0.0.0', () => {
    logger.info('worker_process.health_server_ready', { port: HEALTH_PORT });
});

const startup = async () => {
    logger.info('worker_process.starting', { env: NODE_ENV });

    // Production guards — fail closed on misconfiguration
    assertProductionRedisConfig();
    assertWebhookConfig();
    assertProductionPaymentConfig();
    assertProductionEmailConfig();
    assertProductionOtpSmsConfig();

    await connectDB();
    logger.info('worker_process.db_connected');

    await initRedis();
    logger.info('worker_process.redis_ready');

    await ensureSystemState({ syncIndexes: true });
    const indexSync = await syncCriticalIndexes();
    if (indexSync.failures.length) {
        // Fail closed: the worker stays not-ready so the API's split-runtime
        // probe reports the gap instead of running without integrity indexes.
        workerRuntimeState.startupError = `index_integrity_failed: ${indexSync.failures.map((f) => f.model).join(',')}`;
    }
    await enforceCatalogStartupCheck();

    // Start all background workers
    startPaymentOutboxWorker();
    startOrderEmailWorker();
    startCommerceReconciliationWorker();
    startAdminAnalyticsMonitor();
    startEmailOpsMonitor();
    startStatusMonitorWorker();
    startCatalogWorkers();
    IntelligenceTaskMonitor();
    startOtpSignupMaintenanceWorker();
    workerRuntimeState.ready = true;
    workerRuntimeState.startupError = '';
    workerRuntimeState.readyAt = new Date().toISOString();

    logger.info('worker_process.all_workers_started');
    console.log('Worker process running'.green.bold);
};

startup().catch((error) => {
    workerRuntimeState.ready = false;
    workerRuntimeState.startupError = error.message;
    workerRuntimeState.failedAt = new Date().toISOString();
    logger.error('worker_process.startup_failed', { error: error.message });
    process.exit(1);
});

// Fail-fast mirrors index.js: Node's default since v15 crashes on unhandled
// rejections anyway, but logging first keeps the crash diagnosable in the
// worker's isolated logs. Exit lets the supervisor restart cleanly.
process.on('unhandledRejection', (reason) => {
    logger.error('worker_process.unhandled_rejection', {
        reason: reason instanceof Error ? reason.message : String(reason),
        stack: reason instanceof Error ? reason.stack : undefined,
    });
    setTimeout(() => process.exit(1), 1000).unref();
});

process.on('uncaughtException', (error) => {
    logger.error('worker_process.uncaught_exception', {
        message: error.message,
        stack: error.stack,
    });
    setTimeout(() => process.exit(1), 1000).unref();
});

// Graceful shutdown — quiesce poll workers before draining the health server.
const shutdown = (signal) => {
    logger.info('worker_process.shutdown', { signal });
    for (const [name, stop] of [
        ['payment_outbox', stopPaymentOutboxWorker],
        ['admin_analytics_monitor', stopAdminAnalyticsMonitor],
        ['email_ops_monitor', stopEmailOpsMonitor],
    ]) {
        try {
            stop();
        } catch (error) {
            logger.warn('worker_process.worker_stop_failed', { worker: name, error: error.message });
        }
    }
    healthServer.close(() => {
        process.exit(0);
    });
    setTimeout(() => process.exit(0), 5000).unref();
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

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

const dotenv = require('dotenv');
dotenv.config();

require('colors');
const logger = require('./utils/logger');
const connectDB = require('./config/db');
const { initRedis, assertProductionRedisConfig } = require('./config/redis');
const { assertProductionPaymentConfig, assertWebhookConfig } = require('./config/paymentFlags');
const { assertProductionEmailConfig } = require('./config/emailFlags');
const { assertProductionOtpSmsConfig } = require('./config/otpSmsFlags');
const {
    startPaymentOutboxWorker,
    getPaymentOutboxStats,
} = require('./services/payments/paymentService');
const {
    startOrderEmailWorker,
    getOrderEmailQueueStats,
} = require('./services/email/orderEmailQueueService');
const {
    startCommerceReconciliationWorker,
} = require('./services/commerceReconciliationService');
const { startAdminAnalyticsMonitor } = require('./services/adminAnalyticsMonitorService');
const {
    startCatalogWorkers,
    ensureSystemState,
    enforceCatalogStartupCheck,
} = require('./services/catalogService');
const { IntelligenceTaskMonitor } = require('./services/marketingIntelligenceService');
const { startOtpSignupMaintenanceWorker } = require('./services/otpSignupMaintenanceService');

const NODE_ENV = process.env.NODE_ENV || 'production';

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

    await ensureSystemState();
    await enforceCatalogStartupCheck();

    // Start all background workers
    startPaymentOutboxWorker();
    startOrderEmailWorker();
    startCommerceReconciliationWorker();
    startAdminAnalyticsMonitor();
    startCatalogWorkers();
    IntelligenceTaskMonitor();
    startOtpSignupMaintenanceWorker();

    logger.info('worker_process.all_workers_started');
    console.log('Worker process running'.green.bold);
};

startup().catch((error) => {
    logger.error('worker_process.startup_failed', { error: error.message });
    process.exit(1);
});

// Graceful shutdown
const shutdown = (signal) => {
    logger.info('worker_process.shutdown', { signal });
    // Workers will drain naturally; DB/Redis connections close via process exit
    process.exit(0);
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

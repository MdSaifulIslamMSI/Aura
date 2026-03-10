const dns = require('dns');
dns.setDefaultResultOrder('ipv4first');

const express = require('express');
const http = require('http');
const path = require('path');
const compression = require('compression');
const helmet = require('helmet');
const dotenv = require('dotenv');
const cors = require('cors');
const logger = require('./utils/logger');
const mongoSanitize = require('./middleware/securityMiddleware');
const xssSanitizer = require('./middleware/xssSanitizer');
const activityEmailMiddleware = require('./middleware/activityEmailMiddleware');
const adminNotificationMiddleware = require('./middleware/adminNotificationMiddleware');
const { requestId } = require('./middleware/requestId');
require('colors');

const { notFound, errorHandler } = require('./middleware/errorMiddleware');

dotenv.config();

const connectDB = require('./config/db');
const { getMongoDeploymentHealth } = require('./config/db');
const productRoutes = require('./routes/productRoutes');
const authRoutes = require('./routes/authRoutes');
const userRoutes = require('./routes/userRoutes');
const orderRoutes = require('./routes/orderRoutes');
const chatRoutes = require('./routes/chatRoutes');
const aiRoutes = require('./routes/aiRoutes');
const otpRoutes = require('./routes/otpRoutes');
const listingRoutes = require('./routes/listingRoutes');
const tradeInRoutes = require('./routes/tradeInRoutes');
const priceAlertRoutes = require('./routes/priceAlertRoutes');
const paymentRoutes = require('./routes/paymentRoutes');
const adminPaymentRoutes = require('./routes/adminPaymentRoutes');
const adminOrderEmailRoutes = require('./routes/adminOrderEmailRoutes');
const adminNotificationRoutes = require('./routes/adminNotificationRoutes');
const adminAnalyticsRoutes = require('./routes/adminAnalyticsRoutes');
const adminCatalogRoutes = require('./routes/adminCatalogRoutes');
const adminUserRoutes = require('./routes/adminUserRoutes');
const adminProductRoutes = require('./routes/adminProductRoutes');
const adminOpsRoutes = require('./routes/adminOpsRoutes');
const internalOpsRoutes = require('./routes/internalOpsRoutes');
const observabilityRoutes = require('./routes/observabilityRoutes');
const uploadRoutes = require('./routes/uploadRoutes');
const { serveReviewMediaAsset } = require('./controllers/uploadAssetController');
const { assertProductionPaymentConfig, flags: paymentFlags } = require('./config/paymentFlags');
const { assertProductionEmailConfig, flags: emailFlags } = require('./config/emailFlags');
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
    getCommerceReconciliationStatus,
} = require('./services/commerceReconciliationService');
const { startAdminAnalyticsMonitor } = require('./services/adminAnalyticsMonitorService');
const {
    enforceCatalogStartupCheck,
    startCatalogWorkers,
    getCatalogHealth,
    ensureSystemState,
} = require('./services/catalogService');
const { flags: catalogFlags } = require('./config/catalogFlags');
const {
    assertProductionCorsConfig,
    isOriginAllowed,
    allowedOrigins,
} = require('./config/corsFlags');
const {
    initRedis,
    getRedisHealth,
    assertProductionRedisConfig,
} = require('./config/redis');
const { createDistributedRateLimit } = require('./middleware/distributedRateLimit');
const { metricsMiddleware } = require('./middleware/metrics');
const { createRequestTimeout } = require('./middleware/requestTimeout');
const { getAllBreakerStats } = require('./utils/circuitBreaker');
const metricsRoute = require('./routes/metricsRoute');
const { initializeSocket } = require('./services/socketService');

const app = express();
const JSON_BODY_LIMIT = process.env.JSON_BODY_LIMIT || '12mb';
const runtimeNodeEnv = process.env.NODE_ENV || 'production';
const splitRuntimeEnabled = String(process.env.SPLIT_RUNTIME_ENABLED || 'false').trim().toLowerCase() === 'true';
const requirePublishedCatalog = String(
    process.env.CATALOG_READINESS_REQUIRE_PUBLISHED || (runtimeNodeEnv === 'production' ? 'true' : 'false')
).trim().toLowerCase() !== 'false';

const getSplitRuntimeWorkerGaps = ({
    paymentQueue = {},
    emailQueue = {},
    catalog = {},
    reconciliation = {},
}) => {
    const gaps = [];
    if (paymentFlags.paymentsEnabled && !paymentQueue?.workerRunning) gaps.push('payment_outbox_worker');
    if (emailFlags.orderEmailsEnabled && !emailQueue?.workerRunning) gaps.push('order_email_worker');
    if (catalogFlags.catalogImportsEnabled && !catalog?.workers?.importWorkerRunning) gaps.push('catalog_import_worker');
    if (catalogFlags.catalogSyncEnabled && !catalog?.workers?.syncWorkerRunning) gaps.push('catalog_sync_worker');
    if (String(process.env.COMMERCE_RECONCILIATION_ENABLED || 'true').trim().toLowerCase() !== 'false'
        && !reconciliation?.workerRunning) {
        gaps.push('commerce_reconciliation_worker');
    }
    return gaps;
};

app.set('trust proxy', 1);

// Request ID for tracing
app.use(requestId);

// Prometheus metrics â€” register before any other middleware so durations
// include the full request lifecycle (auth, rate-limit, route handlers).
app.use(metricsMiddleware);

// Request timeout â€” kills connections that hang longer than REQUEST_TIMEOUT_MS.
// Exempt: /health, /metrics, streaming AI routes, file uploads.
app.use(createRequestTimeout());

// Create HTTP server
const server = http.createServer(app);

// Initialize WebSockets
initializeSocket(server);

// JSON HTTP Logging Pipeline
app.use((req, res, next) => {
    const start = Date.now();
    res.on('finish', () => {
        const duration = Date.now() - start;
        logger.info('HTTP Request', {
            method: req.method,
            url: req.originalUrl,
            status: res.statusCode,
            durationMs: duration,
            requestId: req.requestId || req.headers['x-request-id'] || 'unknown',
            clientSessionId: String(req.headers['x-client-session-id'] || ''),
            clientRoute: String(req.headers['x-client-route'] || ''),
            ip: req.ip,
        });
    });
    next();
});

app.use(helmet());
app.use(compression());
app.use(cors({
    origin: (origin, callback) => {
        if (isOriginAllowed(origin)) {
            return callback(null, true);
        }
        return callback(new Error('Origin not allowed by CORS policy'));
    },
    credentials: true,
}));
app.use(express.json({
    limit: JSON_BODY_LIMIT,
    verify: (req, res, buf) => {
        req.rawBody = buf.toString('utf8');
    }
}));

// Security: Data Sanitization
app.use(mongoSanitize());
app.use(xssSanitizer);
app.use(activityEmailMiddleware);
app.use(adminNotificationMiddleware);
app.get(/^\/uploads\/reviews\/(.+)$/, serveReviewMediaAsset);
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Rate Limiting â€” strict for production, disabled in test
if (process.env.NODE_ENV !== 'test') {
    const limiter = createDistributedRateLimit({
        name: 'global',
        windowMs: 15 * 60 * 1000,
        max: process.env.NODE_ENV === 'development' ? 500 : 100,
        message: { status: 'error', message: 'Too many requests, please try again later.' },
    });
    app.use(limiter);
}

// Routes
app.use('/api/products', productRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/chat', chatRoutes);
app.use('/api/ai', aiRoutes);
app.use('/api/otp', otpRoutes);
app.use('/api/listings', listingRoutes);
app.use('/api/trade-in', tradeInRoutes);
app.use('/api/price-alerts', priceAlertRoutes);
app.use('/api/payments', paymentRoutes);
app.use('/api/admin/payments', adminPaymentRoutes);
app.use('/api/admin/order-emails', adminOrderEmailRoutes);
app.use('/api/admin/notifications', adminNotificationRoutes);
app.use('/api/admin/analytics', adminAnalyticsRoutes);
app.use('/api/admin/catalog', adminCatalogRoutes);
app.use('/api/admin/users', adminUserRoutes);
app.use('/api/admin/products', adminProductRoutes);
app.use('/api/admin/ops', adminOpsRoutes);
app.use('/api/internal', internalOpsRoutes);
app.use('/api/observability', observabilityRoutes);
app.use('/api/uploads', uploadRoutes);
app.use('/metrics', metricsRoute);

// Health Check
app.get('/health', async (req, res) => {
    const mongoose = require('mongoose');
    const dbStatus = mongoose.connection.readyState === 1 ? 'connected' : 'disconnected';
    const redis = getRedisHealth();
    const mongoDeployment = await getMongoDeploymentHealth();
    let paymentQueue = { status: 'unknown' };
    let emailQueue = { status: 'unknown' };
    let catalog = { status: 'unknown' };
    let reconciliation = { status: 'unknown' };

    try {
        if (dbStatus === 'connected') {
            [paymentQueue, emailQueue, catalog, reconciliation] = await Promise.all([
                getPaymentOutboxStats(),
                getOrderEmailQueueStats(),
                getCatalogHealth(),
                getCommerceReconciliationStatus(),
            ]);
        }
    } catch (error) {
        logger.warn('health.queue_stats_failed', { error: error.message });
    }

    const status = dbStatus === 'connected' ? 'ok' : 'degraded';
    const workerGaps = getSplitRuntimeWorkerGaps({
        paymentQueue,
        emailQueue,
        catalog,
        reconciliation,
    });
    const splitRuntimeReady = !splitRuntimeEnabled || (
        mongoDeployment.replicaSet
        && (!redis.required || redis.connected)
        && workerGaps.length === 0
    );

    res.status(status === 'ok' ? 200 : 503).json({
        status,
        db: dbStatus,
        uptime: process.uptime(),
        timestamp: new Date().toISOString(),
        app: {
            env: process.env.NODE_ENV || 'production',
            version: process.env.npm_package_version || 'unknown',
        },
        cors: {
            allowedOrigins,
        },
        redis,
        topology: {
            splitRuntimeEnabled,
            splitRuntimeReady,
            workerGaps,
            mongo: mongoDeployment,
        },
        queues: {
            paymentOutbox: paymentQueue,
            orderEmail: emailQueue,
        },
        catalog,
        reconciliation,
    });
});

app.get('/health/ready', async (req, res) => {
    const mongoose = require('mongoose');
    const dbConnected = mongoose.connection.readyState === 1;
    const redis = getRedisHealth();
    const mongoDeployment = await getMongoDeploymentHealth();

    if (!dbConnected) {
        return res.status(503).json({
            ready: false,
            reason: 'database_disconnected',
            timestamp: new Date().toISOString(),
        });
    }

    if (splitRuntimeEnabled && !mongoDeployment.replicaSet) {
        return res.status(503).json({
            ready: false,
            reason: 'mongo_not_replica_set',
            timestamp: new Date().toISOString(),
            topology: mongoDeployment,
        });
    }

    if (redis.required && !redis.connected) {
        return res.status(503).json({
            ready: false,
            reason: 'redis_disconnected',
            timestamp: new Date().toISOString(),
        });
    }

    let catalog = null;
    let paymentQueue = { workerRunning: false };
    let emailQueue = { workerRunning: false };
    let reconciliation = { workerRunning: false };
    try {
        [catalog, paymentQueue, emailQueue, reconciliation] = await Promise.all([
            getCatalogHealth(),
            getPaymentOutboxStats(),
            getOrderEmailQueueStats(),
            getCommerceReconciliationStatus(),
        ]);
    } catch {
        catalog = { staleData: true };
    }

    if (catalog?.staleData) {
        return res.status(503).json({
            ready: false,
            reason: 'catalog_stale',
            timestamp: new Date().toISOString(),
        });
    }

    if (splitRuntimeEnabled) {
        const workerGaps = getSplitRuntimeWorkerGaps({
            paymentQueue,
            emailQueue,
            catalog,
            reconciliation,
        });

        if (workerGaps.length > 0) {
            return res.status(503).json({
                ready: false,
                reason: 'split_runtime_workers_unavailable',
                workerGaps,
                timestamp: new Date().toISOString(),
            });
        }
    }

    if (requirePublishedCatalog && runtimeNodeEnv === 'production') {
        const publishedProductCount = Number(catalog?.quality?.publishedProductCount || 0);
        if (!catalog?.activeVersion || catalog.activeVersion === 'legacy-v1' || publishedProductCount <= 0) {
            return res.status(503).json({
                ready: false,
                reason: 'catalog_not_published',
                activeVersion: catalog?.activeVersion || 'legacy-v1',
                publishedProductCount,
                timestamp: new Date().toISOString(),
            });
        }

        if (Number(catalog?.quality?.devOnlyProducts || 0) > 0 || Number(catalog?.quality?.syntheticRejectedProducts || 0) > 0) {
            return res.status(503).json({
                ready: false,
                reason: 'catalog_publish_gate_failed',
                quality: catalog?.quality || {},
                timestamp: new Date().toISOString(),
            });
        }
    }

    return res.json({
        ready: true,
        timestamp: new Date().toISOString(),
        topology: {
            splitRuntimeEnabled,
            mongo: mongoDeployment,
        },
    });
});

app.get('/', (req, res) => {
    res.send('API is running...');
});

// Error Handling
app.use(notFound);
app.use(errorHandler);

const PORT = process.env.PORT || 5000;
const NODE_ENV = process.env.NODE_ENV || 'production';

if (require.main === module) {
    assertProductionCorsConfig();
    assertProductionPaymentConfig();
    assertProductionEmailConfig();
    assertProductionOtpSmsConfig();
    assertProductionRedisConfig();
    connectDB().then(() => {
        Promise.resolve()
            .then(() => initRedis())
            .then(() => ensureSystemState())
            .then(() => enforceCatalogStartupCheck())
            .then(() => {
                const httpServer = app.listen(PORT, '0.0.0.0', () => {
                    console.log(`Server running in ${NODE_ENV} mode on port ${PORT}`.yellow.bold);
                    // Workers run in-process on the free plan.
                    // For production scale, move to a dedicated worker service.
                    startPaymentOutboxWorker();
                    startOrderEmailWorker();
                    startCommerceReconciliationWorker();
                    startAdminAnalyticsMonitor();
                    startCatalogWorkers();
                });

                // Graceful shutdown â€” drain in-flight requests before process exit.
                // Render sends SIGTERM 10s before SIGKILL during rolling deploys.
                const GRACEFUL_SHUTDOWN_TIMEOUT_MS = Number(process.env.GRACEFUL_SHUTDOWN_TIMEOUT_MS) || 15000;

                const gracefulShutdown = (signal) => {
                    logger.info('server.shutdown_initiated', { signal, timeoutMs: GRACEFUL_SHUTDOWN_TIMEOUT_MS });
                    httpServer.close(async () => {
                        try {
                            const mongoose = require('mongoose');
                            await mongoose.connection.close(false);
                            logger.info('server.mongoose_closed');
                        } catch (err) {
                            logger.warn('server.mongoose_close_failed', { error: err.message });
                        }
                        logger.info('server.shutdown_complete', { signal });
                        process.exit(0);
                    });
                    // Force-exit after timeout to avoid hung connections blocking deploy.
                    setTimeout(() => {
                        logger.error('server.shutdown_timeout', { signal, timeoutMs: GRACEFUL_SHUTDOWN_TIMEOUT_MS });
                        process.exit(1);
                    }, GRACEFUL_SHUTDOWN_TIMEOUT_MS).unref();
                };

                process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
                process.on('SIGINT', () => gracefulShutdown('SIGINT'));
            })
            .catch((error) => {
                logger.error('server.startup_failed', { error: error.message });
                process.exit(1);
            });
    }).catch((error) => {
        logger.error('server.db_connect_failed', { error: error.message });
        process.exit(1);
    });
}

module.exports = app;

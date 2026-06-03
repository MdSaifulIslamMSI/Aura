const dns = require('dns');
dns.setDefaultResultOrder('ipv4first');

const crypto = require('crypto');
const express = require('express');
const http = require('http');
const path = require('path');
const compression = require('compression');
const helmet = require('helmet');
const cors = require('cors');
const { loadLocalEnvFiles } = require('./config/runtimeConfig');
const logger = require('./utils/logger');
const mongoSanitize = require('./middleware/securityMiddleware');
const xssSanitizer = require('./middleware/xssSanitizer');
const activityEmailMiddleware = require('./middleware/activityEmailMiddleware');
const adminNotificationMiddleware = require('./middleware/adminNotificationMiddleware');
const { requestId } = require('./middleware/requestId');
const { originProtectionMiddleware } = require('./middleware/originProtectionMiddleware');
const { authRiskSignalProducerMiddleware } = require('./middleware/authRiskSignalProducerMiddleware');
const { resolveMarketContextMiddleware } = require('./middleware/marketContext');
const { routeCostClassifier } = require('./middleware/routeCostClassifier');
const { bodySizeGuard } = require('./middleware/bodySizeGuards');
const { budgetRequestTimeout } = require('./middleware/requestTimeouts');
const { loadShedding } = require('./middleware/loadShedding');
const { trafficBudgetPolicy } = require('./middleware/trafficBudgetPolicy');
const { queryBudgetGuard } = require('./middleware/queryBudgetGuard');
const { cachePolicy } = require('./middleware/cachePolicy');
const { attackModeGuard } = require('./middleware/attackModeGuard');
const { abuseShield } = require('./middleware/abuseShield');
require('colors');

const { notFound, errorHandler } = require('./middleware/errorMiddleware');
const AppError = require('./utils/AppError');

loadLocalEnvFiles();

const connectDB = require('./config/db');
const { getMongoDeploymentHealth } = require('./config/db');
const productRoutes = require('./routes/productRoutes');
const recommendationRoutes = require('./routes/recommendationRoutes');
const recommendationEventRoutes = require('./routes/recommendationEventRoutes');
const authRoutes = require('./routes/authRoutes');
const userRoutes = require('./routes/userRoutes');
const cartRoutes = require('./routes/cartRoutes');
const orderRoutes = require('./routes/orderRoutes');
const checkoutRoutes = require('./routes/checkoutRoutes');
const aiRoutes = require('./routes/aiRoutes');
const otpRoutes = require('./routes/otpRoutes');
const listingRoutes = require('./routes/listingRoutes');
const tradeInRoutes = require('./routes/tradeInRoutes');
const priceAlertRoutes = require('./routes/priceAlertRoutes');
const paymentRoutes = require('./routes/paymentRoutes');
const emergencyRoutes = require('./routes/emergencyRoutes');
const i18nRoutes = require('./routes/i18nRoutes');
const marketRoutes = require('./routes/marketRoutes');
const adminEmergencyControlRoutes = require('./routes/adminEmergencyControlRoutes');
const adminPaymentRoutes = require('./routes/adminPaymentRoutes');
const adminOrderEmailRoutes = require('./routes/adminOrderEmailRoutes');
const adminEmailOpsRoutes = require('./routes/adminEmailOpsRoutes');
const adminNotificationRoutes = require('./routes/adminNotificationRoutes');
const adminAnalyticsRoutes = require('./routes/adminAnalyticsRoutes');
const adminCatalogRoutes = require('./routes/adminCatalogRoutes');
const adminUserRoutes = require('./routes/adminUserRoutes');
const adminProductRoutes = require('./routes/adminProductRoutes');
const adminOpsRoutes = require('./routes/adminOpsRoutes');
const adminFraudRoutes = require('./routes/adminFraudRoutes');
const adminAbuseRoutes = require('./routes/adminAbuseRoutes');
const statusRoutes = require('./routes/statusRoutes');
const adminStatusRoutes = require('./routes/adminStatusRoutes');
const healthRoutes = require('./routes/healthRoutes');
const internalOpsRoutes = require('./routes/internalOpsRoutes');
const observabilityRoutes = require('./routes/observabilityRoutes');
const emailWebhookRoutes = require('./routes/emailWebhookRoutes');
const uploadRoutes = require('./routes/uploadRoutes');
const intelligenceRoutes = require('./routes/intelligenceRoutes');
const supportRoutes = require('./routes/supportRoutes');
const userNotificationRoutes = require('./routes/userNotificationRoutes');
const { serveReviewMediaAsset } = require('./controllers/uploadAssetController');
const { assertProductionPaymentConfig, assertWebhookConfig, flags: paymentFlags } = require('./config/paymentFlags');
const { assertProductionEmailConfig, flags: emailFlags } = require('./config/emailFlags');
const { assertProductionOtpSmsConfig } = require('./config/otpSmsFlags');
const { assertAuthVaultConfig } = require('./config/authVaultFlags');
const { assertAuthEnvironmentConfig } = require('./config/authEnvironment');
const { assertTrustedDeviceConfig } = require('./config/authTrustedDeviceFlags');
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
const {
    startFxRateScheduler,
    stopFxRateScheduler,
} = require('./services/payments/fxRateService');
const { startAdminAnalyticsMonitor } = require('./services/adminAnalyticsMonitorService');
const { startEmailOpsMonitor } = require('./services/email/emailOpsMonitorService');
const { startStatusMonitorWorker } = require('./services/statusService');
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
    isStagingRuntime: isCorsStagingRuntime,
    allowedOrigins,
} = require('./config/corsFlags');
const { assertSigningSecretsConfig } = require('./config/signingSecrets');
const { assertAuthRiskSignalConfig } = require('./services/authRiskSignalService');
const {
    getRedisHealth,
    initRedis,
    assertProductionRedisConfig,
} = require('./config/redis');
const {
    getCachedHealthSnapshot,
} = require('./services/healthService');
const { checkClamAvReady } = require('./services/malwareScanService');
const {
    buildStartupReadinessFailure,
    getReadinessGraceState,
} = require('./services/healthReadinessService');
const {
    buildHealthMetadata,
    buildPublicHealthPayload,
    shouldFailClosedMissingHealthReadyToken,
    shouldExposeDetailedHealth,
} = require('./services/healthDisclosureService');
const { warmChatModel } = require('./services/ai/modelGatewayService');
const { getChatQuotaHealth } = require('./services/chatQuotaService');
const { getTrustedRequestIp } = require('./utils/requestIdentity');
const { createDistributedRateLimit } = require('./middleware/distributedRateLimit');
const { metricsMiddleware } = require('./middleware/metrics');
const { createRequestTimeout } = require('./middleware/requestTimeout');
const {
    createPublicCacheMiddleware,
    publicCacheInvalidationMiddleware,
} = require('./performance/cache');
const {
    performanceMiddleware,
    staticAssetHeaders,
} = require('./performance/middleware');
const { initOtel } = require('./performance/otel');
const {
    emergencyRoutePolicyMiddleware,
    globalEmergencyMiddleware,
    readOnlyMiddleware,
    strictRateLimitMiddleware,
} = require('./middleware/emergencyControlMiddleware');
const metricsRoute = require('./routes/metricsRoute');
const { attachSocketBackplane, getSocketHealth, initializeSocket } = require('./services/socketService');

const app = express();
initOtel();
const JSON_BODY_LIMIT = process.env.JSON_BODY_LIMIT || '12mb';
const AUTH_BODY_LIMIT = process.env.AUTH_BODY_LIMIT || '64kb';
const runtimeNodeEnv = process.env.NODE_ENV || 'production';
const STAGING_HEALTH_SSM_PREFIX = '/aura/staging';
const toWebSocketOrigin = (origin = '') => String(origin || '').replace(/\/+$/, '').replace(/^https:/i, 'wss:').replace(/^http:/i, 'ws:');
const productionBackendCspSources = isCorsStagingRuntime ? [] : [
    'https://dbtrhsolhec1s.cloudfront.net',
    'wss://dbtrhsolhec1s.cloudfront.net',
];
const cspConnectSources = Array.from(new Set([
    "'self'",
    ...allowedOrigins,
    ...productionBackendCspSources,
    ...allowedOrigins.map(toWebSocketOrigin),
    'https://api.github.com',
    'https://api.stripe.com',
    'https://js.stripe.com',
    'https://hooks.stripe.com',
    'https://checkout.razorpay.com',
    'https://api.razorpay.com',
    'https://*.razorpay.com',
    'https://*.googleapis.com',
    'https://securetoken.googleapis.com',
    'https://identitytoolkit.googleapis.com',
    'https://firebaseinstallations.googleapis.com',
    'https://firebaselogging.googleapis.com',
    'https://www.google.com',
    'https://www.gstatic.com',
    'https://www.recaptcha.net',
    'https://challenges.cloudflare.com',
    'https://*.firebaseio.com',
    'https://*.firebaseapp.com',
    'https://*.web.app',
    'https://*.livekit.cloud',
    'wss://*.livekit.cloud',
].filter(Boolean)));
const contentSecurityPolicyDirectives = {
    defaultSrc: ["'self'"],
    baseUri: ["'self'"],
    objectSrc: ["'none'"],
    frameAncestors: ["'none'"],
    formAction: ["'self'"],
    scriptSrc: [
        "'self'",
        'https://apis.google.com',
        'https://accounts.google.com',
        'https://checkout.razorpay.com',
        'https://js.stripe.com',
        'https://www.google.com',
        'https://www.gstatic.com',
        'https://www.recaptcha.net',
        'https://challenges.cloudflare.com',
    ],
    styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
    fontSrc: ["'self'", 'https://fonts.gstatic.com', 'data:'],
    imgSrc: ["'self'", 'data:', 'blob:', 'https:'],
    connectSrc: cspConnectSources,
    frameSrc: [
        "'self'",
        'https://accounts.google.com',
        'https://checkout.razorpay.com',
        'https://js.stripe.com',
        'https://hooks.stripe.com',
        'https://www.google.com',
        'https://www.recaptcha.net',
        'https://challenges.cloudflare.com',
        'https://*.firebaseapp.com',
        'https://*.web.app',
        'https://app.powerbi.com',
    ],
    workerSrc: ["'self'", 'blob:'],
    manifestSrc: ["'self'"],
};
const splitRuntimeEnabled = String(process.env.SPLIT_RUNTIME_ENABLED || 'false').trim().toLowerCase() === 'true';
const metricsEnabled = String(process.env.METRICS_ENABLED || 'true').trim().toLowerCase() !== 'false';
const rawMetricsPath = String(process.env.METRICS_PATH || '/metrics').trim() || '/metrics';
const metricsPath = rawMetricsPath.startsWith('/') ? rawMetricsPath : `/${rawMetricsPath}`;
logger.info('config.split_runtime_env_check', { 
    raw: process.env.SPLIT_RUNTIME_ENABLED, 
    parsed: splitRuntimeEnabled,
});
const requirePublishedCatalog = String(
    process.env.CATALOG_READINESS_REQUIRE_PUBLISHED || (runtimeNodeEnv === 'production' ? 'true' : 'false')
).trim().toLowerCase() !== 'false';
const runtimeStartupState = {
    asyncStartupComplete: false,
    asyncStartupError: '',
    asyncStartupCompletedAt: null,
    asyncStartupFailedAt: null,
};
const HEALTH_READY_TOKEN = String(process.env.HEALTH_READY_TOKEN || '').trim();

const safeTimingEqual = (candidate = '', expected = '') => {
    const candidateBuffer = Buffer.from(String(candidate));
    const expectedBuffer = Buffer.from(String(expected));
    return candidateBuffer.length === expectedBuffer.length
        && crypto.timingSafeEqual(candidateBuffer, expectedBuffer);
};

const requireHealthReadyAccess = (req, res, next) => {
    if (!HEALTH_READY_TOKEN) {
        if (shouldFailClosedMissingHealthReadyToken({
            healthReadyToken: HEALTH_READY_TOKEN,
            runtimeNodeEnv,
        })) {
            res.set('Cache-Control', 'no-store');
            return res.status(503).json({
                ready: false,
                reason: 'health_ready_token_not_configured',
                timestamp: new Date().toISOString(),
            });
        }
        return next();
    }

    const providedToken = String(req.get('x-health-token') || '').trim();
    if (!providedToken || !safeTimingEqual(providedToken, HEALTH_READY_TOKEN)) {
        res.set('Cache-Control', 'no-store');
        return res.status(401).json({
            ready: false,
            reason: 'health_ready_token_required',
            timestamp: new Date().toISOString(),
        });
    }

    return next();
};

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

app.disable('x-powered-by');
app.set('etag', 'weak');
app.set('trust proxy', 1);

const uploadAssetLimiter = createDistributedRateLimit({
    allowInMemoryFallback: true,
    name: 'upload_asset_read',
    windowMs: 5 * 60 * 1000,
    max: process.env.NODE_ENV === 'development' ? 600 : 240,
    message: { status: 'error', message: 'Too many media requests, please try again later.' },
    keyGenerator: (req) => getTrustedRequestIp(req),
});

const healthReadyLimiter = createDistributedRateLimit({
    allowInMemoryFallback: true,
    name: 'health_ready',
    windowMs: 60 * 1000,
    max: process.env.NODE_ENV === 'development' ? 120 : 30,
    message: { status: 'error', message: 'Too many readiness checks, please try again later.' },
    keyGenerator: (req) => getTrustedRequestIp(req),
});

const buildLiveHealthPayload = () => ({
    alive: true,
    ...buildHealthMetadata(),
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    topology: {
        splitRuntimeEnabled,
    },
    startup: {
        asyncStartupComplete: runtimeStartupState.asyncStartupComplete,
        asyncStartupHealthy: !runtimeStartupState.asyncStartupError,
        asyncStartupCompletedAt: runtimeStartupState.asyncStartupCompletedAt,
        asyncStartupFailedAt: runtimeStartupState.asyncStartupFailedAt,
    },
});

// Fast-path liveness route for the frontend banner. Register it before the
// heavy middleware stack so health polling stays cheap.
app.get('/health/live', (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.set('Content-Security-Policy', "default-src 'self'");
    res.json(buildLiveHealthPayload());
});

// Request ID for tracing
app.use(requestId);
app.use(routeCostClassifier);
app.use(budgetRequestTimeout());
app.use(performanceMiddleware());

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

app.use(originProtectionMiddleware);
app.use(authRiskSignalProducerMiddleware);
app.use(loadShedding());

app.use(helmet({
    contentSecurityPolicy: {
        useDefaults: false,
        directives: contentSecurityPolicyDirectives,
    },
    crossOriginOpenerPolicy: { policy: 'same-origin-allow-popups' },
    crossOriginResourcePolicy: { policy: 'same-site' },
    referrerPolicy: { policy: 'no-referrer' },
}));
app.use(compression());
app.use(cors({
    origin: (origin, callback) => {
        if (isOriginAllowed(origin)) {
            return callback(null, true);
        }
        return callback(new AppError('Origin not allowed by CORS policy', 403));
    },
    credentials: true,
    exposedHeaders: ['X-CSRF-Token', 'X-Request-Id', 'X-Cache', 'Server-Timing'],
}));
app.use(bodySizeGuard());
const captureRawBody = (req, res, buf) => {
    req.rawBody = buf.toString('utf8');
};
app.use(['/api/auth', '/api/otp'], express.json({
    limit: AUTH_BODY_LIMIT,
    verify: captureRawBody,
}));
app.use(['/api/auth', '/api/otp'], express.urlencoded({
    extended: false,
    limit: AUTH_BODY_LIMIT,
    parameterLimit: 25,
}));
app.use(express.json({
    limit: JSON_BODY_LIMIT,
    verify: captureRawBody,
}));
app.use(express.urlencoded({
    extended: false,
    limit: JSON_BODY_LIMIT,
    parameterLimit: 100,
}));
app.use(resolveMarketContextMiddleware);

// Security: Data Sanitization
app.use(mongoSanitize());
app.use(xssSanitizer);
app.use(cachePolicy());
app.use(queryBudgetGuard());
app.use(trafficBudgetPolicy());
app.use(abuseShield());
app.use(activityEmailMiddleware);
app.use(adminNotificationMiddleware);
app.get(/^\/uploads\/reviews\/(.+)$/, uploadAssetLimiter, serveReviewMediaAsset);
app.use('/uploads', uploadAssetLimiter, express.static(path.join(__dirname, 'uploads')));

// Rate Limiting â€” strict for production, disabled in test
if (process.env.NODE_ENV !== 'test') {
    const limiter = createDistributedRateLimit({
        allowInMemoryFallback: true,
        name: 'global',
        windowMs: 15 * 60 * 1000,
        max: process.env.NODE_ENV === 'development' ? 500 : 600,
        message: { status: 'error', message: 'Too many requests, please try again later.' },
        skip: (req) => {
            const path = String(req.path || req.originalUrl || '').trim().toLowerCase();
            return path === '/health'
                || path.startsWith('/api/health')
                || path === metricsPath
                || path.startsWith('/api/email-webhooks')
                || path.startsWith('/api/observability');
        },
        keyGenerator: (req) => getTrustedRequestIp(req),
    });
    app.use(limiter);
}

app.use(publicCacheInvalidationMiddleware());
app.use(createPublicCacheMiddleware());

// Routes
app.use('/api/health', healthRoutes);
app.use('/api/emergency', emergencyRoutes);
app.use(globalEmergencyMiddleware);
app.use(readOnlyMiddleware);
app.use(strictRateLimitMiddleware);
app.use(emergencyRoutePolicyMiddleware);
app.use(attackModeGuard());

app.use('/api/products', productRoutes);
app.use('/api/recommendations', recommendationRoutes);
app.use('/api/recommendation-events', recommendationEventRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/cart', cartRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/checkout', checkoutRoutes);
app.use('/api/ai', aiRoutes);
app.use('/api/otp', otpRoutes);
app.use('/api/listings', listingRoutes);
app.use('/api/trade-in', tradeInRoutes);
app.use('/api/price-alerts', priceAlertRoutes);
app.use('/api/payments', paymentRoutes);
app.use('/api/i18n', i18nRoutes);
app.use('/api/markets', marketRoutes);
app.use('/api/status', statusRoutes);
app.use('/api/admin/emergency-controls', adminEmergencyControlRoutes);
app.use('/api/admin/payments', adminPaymentRoutes);
app.use('/api/admin/order-emails', adminOrderEmailRoutes);
app.use('/api/admin/email-ops', adminEmailOpsRoutes);
app.use('/api/admin/notifications', adminNotificationRoutes);
app.use('/api/admin/analytics', adminAnalyticsRoutes);
app.use('/api/admin/catalog', adminCatalogRoutes);
app.use('/api/admin/users', adminUserRoutes);
app.use('/api/admin/products', adminProductRoutes);
app.use('/api/admin/ops', adminOpsRoutes);
app.use('/api/admin/fraud', adminFraudRoutes);
app.use('/api/admin/abuse', adminAbuseRoutes);
app.use('/api/admin/status', adminStatusRoutes);
app.use('/api/internal', internalOpsRoutes);
app.use('/api/observability', observabilityRoutes);
app.use('/api/email-webhooks', emailWebhookRoutes);
app.use('/api/uploads', uploadRoutes);
app.use('/api/intelligence', intelligenceRoutes);
app.use('/api/support', supportRoutes);
app.use('/api/notifications', userNotificationRoutes);
if (metricsEnabled) {
    app.use(metricsPath, metricsRoute);
}

const isStagingRuntime = () => (
    String(process.env.APP_ENV || process.env.SMOKE_TARGET_ENV || '').trim().toLowerCase() === 'staging'
    || String(process.env.STAGING_SSM_PREFIX || process.env.AWS_PARAMETER_STORE_PATH_PREFIX || '').trim() === STAGING_HEALTH_SSM_PREFIX
);

const getStagingStorageFingerprint = () => {
    const bucket = String(process.env.S3_BUCKET || process.env.AWS_S3_BUCKET || process.env.STAGING_BUCKET_NAME || '').toLowerCase();
    if (!bucket) return 'not_ready';
    if (bucket.includes('prod') || bucket.includes('production')) return 'invalid';
    return 'staging';
};

const buildStagingHealthFingerprint = async (core) => {
    if (!isStagingRuntime()) return {};

    const ssmPrefix = String(process.env.STAGING_SSM_PREFIX || process.env.AWS_PARAMETER_STORE_PATH_PREFIX || '').trim();
    const scannerHealth = await checkClamAvReady({ timeoutMs: 1000 }).catch((error) => ({
        ready: false,
        detail: error?.message || 'scanner readiness failed',
    }));
    const database = core.dbConnected ? 'staging' : 'not_ready';
    const cache = core.redisConnected ? 'staging' : 'not_ready';
    const storage = getStagingStorageFingerprint();
    const scanner = scannerHealth.ready ? 'ready' : 'not_ready';

    return {
        ok: ssmPrefix === STAGING_HEALTH_SSM_PREFIX
            && database === 'staging'
            && cache === 'staging'
            && storage === 'staging'
            && scanner === 'ready',
        env: 'staging',
        ssmPrefix,
        database,
        cache,
        storage,
        scanner,
    };
};

// Health Check
app.get('/health', async (req, res) => {
    const snapshot = await getCachedHealthSnapshot();
    const { core, services } = snapshot;
    const status = core.dbConnected && core.redisConnected ? 'ok' : 'degraded';
    const uptime = process.uptime();
    const timestamp = new Date().toISOString();
    const exposeDetailedHealth = shouldExposeDetailedHealth({
        req,
        healthReadyToken: HEALTH_READY_TOKEN,
        runtimeNodeEnv,
    });

    res.set('Cache-Control', 'no-store');
    res.set('X-Health-Cache', snapshot.cacheState);
    if (!exposeDetailedHealth) {
        const stagingHealthFingerprint = await buildStagingHealthFingerprint(core);
        return res.status(status === 'ok' ? 200 : 503).json({
            ...buildPublicHealthPayload({
                status,
                core,
                uptime,
                timestamp,
            }),
            ...stagingHealthFingerprint,
        });
    }

    const workerGaps = getSplitRuntimeWorkerGaps({
        paymentQueue: services.paymentQueue,
        emailQueue: services.emailQueue,
        catalog: services.catalog,
        reconciliation: services.reconciliation,
    });
    const stagingHealthFingerprint = await buildStagingHealthFingerprint(core);
    const detailedHealthPayload = {
        status,
        ...buildHealthMetadata(),
        db: core.dbConnected ? 'connected' : 'disconnected',
        uptime,
        timestamp,
        ...stagingHealthFingerprint,
        redis: {
            connected: core.redisConnected,
        },
        topology: {
            splitRuntimeEnabled,
            splitRuntimeReady: splitRuntimeEnabled ? workerGaps.length === 0 : true,
            workerGaps,
            mongo: core.mongoDeployment,
        },
        startup: {
            asyncStartupComplete: runtimeStartupState.asyncStartupComplete,
            asyncStartupHealthy: !runtimeStartupState.asyncStartupError,
            asyncStartupCompletedAt: runtimeStartupState.asyncStartupCompletedAt,
            asyncStartupFailedAt: runtimeStartupState.asyncStartupFailedAt,
        },
        queues: {
            paymentOutbox: services.paymentQueue || { status: 'unknown' },
            orderEmail: services.emailQueue || { status: 'unknown' },
        },
        ai: services.ai || {
            chatQuota: {
                mode: 'local',
                distributed: false,
            },
        },
        catalog: services.catalog || { status: 'unknown' },
        reconciliation: services.reconciliation || { status: 'unknown' },
        fx: services.fx || { status: 'unknown' },
        realtime: services.realtime || {
            socket: getSocketHealth(),
            videoCalls: { activeRinging: 0, activeConnected: 0, endedRecently: 0 },
        },
    };

    return res.status(status === 'ok' ? 200 : 503).json(detailedHealthPayload);
});

app.get('/health/ready', healthReadyLimiter, requireHealthReadyAccess, async (req, res) => {
    const mongoose = require('mongoose');
    const dbConnected = mongoose.connection.readyState === 1;
    const redis = getRedisHealth();
    let mongoDeployment = { connected: dbConnected, readyState: mongoose.connection.readyState };
    try {
        // Use a short timeout for the hello command during readiness check to avoid blocking Render
        // 5s is plenty for a warm connection, but prevents a 30s hang if Atlas is handshaking.
        mongoDeployment = await Promise.race([
            getMongoDeploymentHealth(),
            new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 5000))
        ]);
    } catch (error) {
        logger.warn('health.mongo_deployment_check_timeout', { error: error.message, dbConnected });
    }

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

    const uptime = process.uptime();
    const { isWithinGracePeriod } = getReadinessGraceState({
        env: process.env,
        runtimeNodeEnv,
        uptime,
    });
    const startupReadinessFailure = buildStartupReadinessFailure({
        runtimeNodeEnv,
        runtimeStartupState,
        isWithinGracePeriod,
        uptime,
    });
    if (startupReadinessFailure) {
        return res.status(503).json(startupReadinessFailure);
    }

    if (catalog?.staleData) {
        if (!isWithinGracePeriod) {
            return res.status(503).json({
                ready: false,
                reason: 'catalog_stale',
                uptime,
                timestamp: new Date().toISOString(),
            });
        }
        logger.warn('health.ready_grace_active', { reason: 'catalog_stale', uptime });
    }

    if (splitRuntimeEnabled) {
        const workerGaps = getSplitRuntimeWorkerGaps({
            paymentQueue,
            emailQueue,
            catalog,
            reconciliation,
        });

        if (workerGaps.length > 0) {
            if (!isWithinGracePeriod) {
                return res.status(503).json({
                    ready: false,
                    reason: 'split_runtime_workers_unavailable',
                    workerGaps,
                    uptime,
                    timestamp: new Date().toISOString(),
                });
            }
            logger.warn('health.ready_grace_active', { reason: 'split_runtime_workers_unavailable', workerGaps, uptime });
        }
    }

    if (requirePublishedCatalog && runtimeNodeEnv === 'production') {
        const publishedProductCount = Number(catalog?.quality?.publishedProductCount || 0);
        const isInitialCatalog = !catalog?.activeVersion || catalog.activeVersion === 'legacy-v1' || publishedProductCount <= 0;
        const gateFailed = Number(catalog?.quality?.devOnlyProducts || 0) > 0 || Number(catalog?.quality?.syntheticRejectedProducts || 0) > 0;

        if (isInitialCatalog || gateFailed) {
            if (!isWithinGracePeriod) {
                return res.status(503).json({
                    ready: false,
                    reason: isInitialCatalog ? 'catalog_not_published' : 'catalog_publish_gate_failed',
                    activeVersion: catalog?.activeVersion || 'legacy-v1',
                    publishedProductCount,
                    quality: catalog?.quality || {},
                    uptime,
                    timestamp: new Date().toISOString(),
                });
            }
            logger.warn('health.ready_grace_active', { 
                reason: isInitialCatalog ? 'catalog_not_published' : 'catalog_publish_gate_failed', 
                uptime,
                activeVersion: catalog?.activeVersion || 'legacy-v1'
            });
        }
    }

    return res.json({
        ready: true,
        uptime,
        gracePeriodEnabled: isWithinGracePeriod,
        timestamp: new Date().toISOString(),
        startup: {
            asyncStartupComplete: runtimeStartupState.asyncStartupComplete,
            asyncStartupHealthy: !runtimeStartupState.asyncStartupError,
            asyncStartupCompletedAt: runtimeStartupState.asyncStartupCompletedAt,
            asyncStartupFailedAt: runtimeStartupState.asyncStartupFailedAt,
        },
        ai: {
            chatQuota: getChatQuotaHealth(),
        },
        topology: {
            splitRuntimeEnabled,
            mongo: mongoDeployment,
        },
        realtime: getSocketHealth(),
    });
});

// Serve Frontend
app.use(express.static(path.join(__dirname, 'public'), {
    etag: true,
    setHeaders: staticAssetHeaders,
}));
app.get('{*path}', (req, res, next) => {
    if (req.originalUrl.startsWith('/api/') || req.originalUrl.startsWith('/health') || req.originalUrl.startsWith(metricsPath)) {
        return next();
    }
    res.sendFile(path.resolve(__dirname, 'public', 'index.html'));
});

// Error Handling
app.use(notFound);
app.use(errorHandler);

const PORT = process.env.PORT || 5000;
const NODE_ENV = process.env.NODE_ENV || 'production';

if (require.main === module) {
// Production security: Ensure all signing secrets are present before startup
    assertSigningSecretsConfig();
    assertAuthRiskSignalConfig();
    assertProductionCorsConfig();
    assertWebhookConfig();
    assertProductionPaymentConfig();
    assertProductionEmailConfig();
assertProductionOtpSmsConfig();
assertProductionRedisConfig();
    assertAuthVaultConfig();
    assertAuthEnvironmentConfig();
    assertTrustedDeviceConfig();

    connectDB().then(() => {
        // Start listening IMMEDIATELY after DB connection to satisfy Render health checks.
        // Async startup tasks (Redis, Catalog, Workers) will run in the background.
        const httpServer = server.listen(PORT, '0.0.0.0', () => {
            logger.info(`Server running in ${NODE_ENV} mode on port ${PORT}`.yellow.bold);
            logger.info('server.startup_bind_success', { port: PORT, env: NODE_ENV });

            try {
                startFxRateScheduler();
            } catch (error) {
                logger.error('server.fx_scheduler_start_failed', { error: error.message });
            }

            // Run intensive startup tasks asynchronously
            Promise.resolve()
                .then(() => initRedis())
                .then(() => attachSocketBackplane())
                .then(() => ensureSystemState())
                .then(() => enforceCatalogStartupCheck())
                .then(() => {
                    Promise.resolve()
                        .then(() => warmChatModel({ reason: 'server_async_startup' }))
                        .catch((error) => {
                            logger.warn('server.model_gateway_warmup_failed', { error: error.message });
                        });
                    startPaymentOutboxWorker();
                    startOrderEmailWorker();
                    startCommerceReconciliationWorker();
                    startAdminAnalyticsMonitor();
                    startEmailOpsMonitor();
                    startStatusMonitorWorker();
                    startCatalogWorkers();
                    runtimeStartupState.asyncStartupComplete = true;
                    runtimeStartupState.asyncStartupError = '';
                    runtimeStartupState.asyncStartupCompletedAt = new Date().toISOString();
                    logger.info('server.async_startup_complete');
                })
                .catch((error) => {
                    runtimeStartupState.asyncStartupComplete = false;
                    runtimeStartupState.asyncStartupError = error.message;
                    runtimeStartupState.asyncStartupFailedAt = new Date().toISOString();
                    logger.error('server.async_startup_failed', { error: error.message });
                });
        });

        // Graceful shutdown — drain in-flight requests before process exit.
        // Render sends SIGTERM 10s before SIGKILL during rolling deploys.
        const GRACEFUL_SHUTDOWN_TIMEOUT_MS = Number(process.env.GRACEFUL_SHUTDOWN_TIMEOUT_MS) || 15000;

        const gracefulShutdown = (signal) => {
            logger.info('server.shutdown_initiated', { signal, timeoutMs: GRACEFUL_SHUTDOWN_TIMEOUT_MS });
            httpServer.close(async () => {
                try {
                    stopFxRateScheduler();
                } catch (err) {
                    logger.warn('server.fx_scheduler_stop_failed', { error: err.message });
                }
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

        process.on('unhandledRejection', (reason, promise) => {
            logger.error('server.unhandled_rejection', { 
                reason: reason instanceof Error ? reason.message : String(reason),
                stack: reason instanceof Error ? reason.stack : undefined
            });
        });

        process.on('uncaughtException', (error) => {
            logger.error('server.uncaught_exception', { 
                message: error.message,
                stack: error.stack
            });
            // Give the logger time to write before exiting
            setTimeout(() => process.exit(1), 1000).unref();
        });

    }).catch((error) => {
        logger.error('server.db_connect_failed', { error: error.message });
        process.exit(1);
    });
}

module.exports = app;
  

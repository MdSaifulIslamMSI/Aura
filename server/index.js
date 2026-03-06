const dns = require('dns');
dns.setDefaultResultOrder('ipv4first');

const express = require('express');
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
const productRoutes = require('./routes/productRoutes');
const userRoutes = require('./routes/userRoutes');
const orderRoutes = require('./routes/orderRoutes');
const chatRoutes = require('./routes/chatRoutes');
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
const uploadRoutes = require('./routes/uploadRoutes');
const { assertProductionPaymentConfig } = require('./config/paymentFlags');
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
const { startAdminAnalyticsMonitor } = require('./services/adminAnalyticsMonitorService');
const {
    enforceCatalogStartupCheck,
    startCatalogWorkers,
    getCatalogHealth,
    ensureSystemState,
} = require('./services/catalogService');
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

const app = express();
const JSON_BODY_LIMIT = process.env.JSON_BODY_LIMIT || '12mb';

app.set('trust proxy', 1);

// Request ID for tracing
app.use(requestId);

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
            requestId: req.headers['x-request-id'] || 'unknown',
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
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Rate Limiting — strict for production, disabled in test
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
app.use('/api/users', userRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/chat', chatRoutes);
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
app.use('/api/uploads', uploadRoutes);

// Health Check
app.get('/health', async (req, res) => {
    const mongoose = require('mongoose');
    const dbStatus = mongoose.connection.readyState === 1 ? 'connected' : 'disconnected';
    const redis = getRedisHealth();
    let paymentQueue = { status: 'unknown' };
    let emailQueue = { status: 'unknown' };
    let catalog = { status: 'unknown' };

    try {
        if (dbStatus === 'connected') {
            [paymentQueue, emailQueue, catalog] = await Promise.all([
                getPaymentOutboxStats(),
                getOrderEmailQueueStats(),
                getCatalogHealth(),
            ]);
        }
    } catch (error) {
        logger.warn('health.queue_stats_failed', { error: error.message });
    }

    const status = dbStatus === 'connected' ? 'ok' : 'degraded';

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
        queues: {
            paymentOutbox: paymentQueue,
            orderEmail: emailQueue,
        },
        catalog,
    });
});

app.get('/health/ready', async (req, res) => {
    const mongoose = require('mongoose');
    const dbConnected = mongoose.connection.readyState === 1;
    const redis = getRedisHealth();

    if (!dbConnected) {
        return res.status(503).json({
            ready: false,
            reason: 'database_disconnected',
            timestamp: new Date().toISOString(),
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
    try {
        catalog = await getCatalogHealth();
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

    return res.json({
        ready: true,
        timestamp: new Date().toISOString(),
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
                app.listen(PORT, '0.0.0.0', () => {
                    console.log(`Server running in ${NODE_ENV} mode on port ${PORT}`.yellow.bold);
                    startPaymentOutboxWorker();
                    startOrderEmailWorker();
                    startAdminAnalyticsMonitor();
                    startCatalogWorkers();
                });
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

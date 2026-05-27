const express = require('express');
const mongoose = require('mongoose');

const { getRedisHealth } = require('../config/redis');
const { flags: emailFlags } = require('../config/emailFlags');
const { flags: paymentFlags } = require('../config/paymentFlags');
const { getCachedHealthSnapshot } = require('../services/healthService');
const { buildHealthMetadata } = require('../services/healthDisclosureService');
const { getReviewUploadStorageHealth } = require('../services/reviewMediaStorageService');

const router = express.Router();

const CHECK_TIMEOUT_MS = Math.max(Number(process.env.HEALTH_CHECK_TIMEOUT_MS || 2500), 500);

const withTimeout = async (name, task, timeoutMs = CHECK_TIMEOUT_MS) => {
    const startedAt = Date.now();
    try {
        const result = await Promise.race([
            Promise.resolve().then(task),
            new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), timeoutMs)),
        ]);
        return {
            status: result?.status || (result?.healthy === false ? 'degraded' : 'healthy'),
            latencyMs: Date.now() - startedAt,
            ...result,
        };
    } catch (error) {
        return {
            status: 'degraded',
            latencyMs: Date.now() - startedAt,
            reason: error.message === 'timeout' ? `${name}_timeout` : `${name}_unavailable`,
        };
    }
};

const statusRank = (status = 'healthy') => {
    const normalized = String(status || '').toLowerCase();
    if (['unhealthy', 'down', 'failed'].includes(normalized)) return 3;
    if (['degraded', 'unknown', 'stale'].includes(normalized)) return 2;
    return 1;
};

const aggregateStatus = (checks = {}) => {
    const values = Object.values(checks).map((check) => check?.status || 'healthy');
    if (values.some((status) => statusRank(status) >= 3)) return 'unhealthy';
    if (values.some((status) => statusRank(status) >= 2)) return 'degraded';
    return 'healthy';
};

const sendHealth = (req, res, checks, extra = {}) => {
    const status = aggregateStatus(checks);
    res.set('Cache-Control', 'no-store');
    res.set('X-Request-Id', req.requestId || req.headers['x-request-id'] || '');
    return res.status(status === 'healthy' ? 200 : 503).json({
        status,
        ...buildHealthMetadata(),
        timestamp: new Date().toISOString(),
        correlationId: req.requestId || req.headers['x-request-id'] || '',
        checks,
        ...extra,
    });
};

const checkDb = () => withTimeout('database', async () => {
    const connected = mongoose.connection.readyState === 1;
    if (!connected) return { status: 'unhealthy', reason: 'database_disconnected' };
    await mongoose.connection.db.admin().ping();
    return { status: 'healthy' };
});

const checkRedis = () => withTimeout('redis', async () => {
    const redis = getRedisHealth();
    if (redis.required && !redis.connected) return { status: 'unhealthy', reason: 'redis_disconnected' };
    return {
        status: redis.connected || !redis.required ? 'healthy' : 'degraded',
        required: Boolean(redis.required),
    };
});

const checkEmail = () => withTimeout('email', async () => {
    const provider = emailFlags.orderEmailProvider;
    const disabled = ['null', 'none', 'disabled'].includes(provider) || !emailFlags.orderEmailsEnabled;
    if (disabled) return { status: 'healthy', mode: 'disabled' };
    if (provider === 'resend') return { status: process.env.RESEND_API_KEY ? 'healthy' : 'degraded', provider };
    if (provider === 'gmail') return { status: process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD ? 'healthy' : 'degraded', provider };
    return { status: 'degraded', provider: 'unsupported' };
});

const checkPayments = () => withTimeout('payments', async () => {
    if (!paymentFlags.paymentsEnabled) return { status: 'healthy', mode: 'disabled' };
    const stripeReady = Boolean(process.env.STRIPE_SECRET_KEY || process.env.STRIPE_PUBLISHABLE_KEY);
    const razorpayReady = Boolean(process.env.RAZORPAY_KEY_ID);
    return {
        status: stripeReady || razorpayReady ? 'healthy' : 'degraded',
        provider: paymentFlags.paymentProvider,
    };
});

const checkAi = () => withTimeout('ai', async () => {
    const snapshot = await getCachedHealthSnapshot();
    const ai = snapshot?.services?.ai || {};
    const assistant = ai.commerceAssistant || {};
    if (assistant.healthy === false) return { status: 'degraded', reason: 'provider_timeout' };
    return { status: 'healthy' };
});

const checkUploads = () => withTimeout('uploads', async () => {
    const upload = await getReviewUploadStorageHealth();
    return {
        status: upload.ok ? 'healthy' : 'degraded',
        reason: upload.ok ? undefined : 'upload_storage_unavailable',
    };
});

router.get('/', async (req, res) => {
    const [database, redis] = await Promise.all([checkDb(), checkRedis()]);
    return sendHealth(req, res, { database, redis });
});

router.get('/live', (req, res) => {
    res.set('Cache-Control', 'no-store');
    return res.status(200).json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        correlationId: req.requestId || req.headers['x-request-id'] || '',
        checks: {
            process: {
                status: 'healthy',
                uptime: process.uptime(),
            },
        },
    });
});

router.get('/ready', async (req, res) => {
    const [database, redis] = await Promise.all([checkDb(), checkRedis()]);
    return sendHealth(req, res, { database, redis });
});

router.get('/deep', async (req, res) => {
    const [database, redis, email, payments, ai, uploads] = await Promise.all([
        checkDb(),
        checkRedis(),
        checkEmail(),
        checkPayments(),
        checkAi(),
        checkUploads(),
    ]);
    return sendHealth(req, res, { database, redis, email, payments, ai, uploads });
});

router.get('/db', async (req, res) => sendHealth(req, res, { database: await checkDb() }));
router.get('/redis', async (req, res) => sendHealth(req, res, { redis: await checkRedis() }));
router.get('/email', async (req, res) => sendHealth(req, res, { email: await checkEmail() }));
router.get('/payments', async (req, res) => sendHealth(req, res, { payments: await checkPayments() }));
router.get('/ai', async (req, res) => sendHealth(req, res, { ai: await checkAi() }));
router.get('/uploads', async (req, res) => sendHealth(req, res, { uploads: await checkUploads() }));

module.exports = router;

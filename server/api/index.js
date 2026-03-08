const mongoose = require('mongoose');
const app = require('../index');
const logger = require('../utils/logger');
const { initRedis } = require('../config/redis');
const { ensureSystemState } = require('../services/catalogService');
const { runMaintenanceTasks } = require('../services/opsMaintenanceService');

const splitRuntimeEnabled = String(process.env.SPLIT_RUNTIME_ENABLED || '').trim().toLowerCase() === 'true';

let bootPromise = null;
const maintenanceState = {
    paymentOutbox: { running: false, lastRunAt: 0, minIntervalMs: 60 * 1000 },
    orderEmail: { running: false, lastRunAt: 0, minIntervalMs: 2 * 60 * 1000 },
    adminAnalytics: { running: false, lastRunAt: 0, minIntervalMs: 15 * 60 * 1000 },
};
const MONGO_CONNECT_OPTIONS = {
    serverSelectionTimeoutMS: 30000,
    socketTimeoutMS: 180000,
};

const connectMongo = async () => {
    if (mongoose.connection.readyState === 1) {
        return mongoose.connection;
    }

    if (mongoose.connection.readyState === 2) {
        await mongoose.connection.asPromise();
        return mongoose.connection;
    }

    if (!process.env.MONGO_URI) {
        throw new Error('MONGO_URI is required for backend deployment');
    }

    await mongoose.connect(process.env.MONGO_URI, MONGO_CONNECT_OPTIONS);
    return mongoose.connection;
};

const ensureBootstrapped = async () => {
    // Parallel cold-start requests can arrive before Mongoose flips to the
    // "connecting" state. Reuse the first boot promise unconditionally.
    if (bootPromise) {
        return bootPromise;
    }

    bootPromise = (async () => {
        await connectMongo();
        await initRedis();
        await ensureSystemState();
        logger.info('vercel.backend_ready', {
            dbReadyState: mongoose.connection.readyState,
            redisEnabled: Boolean(process.env.REDIS_ENABLED),
            vercelEnv: process.env.VERCEL_ENV || 'unknown',
        });
    })().catch((error) => {
        bootPromise = null;
        logger.error('vercel.backend_boot_failed', { error: error.message });
        throw error;
    });

    return bootPromise;
};

const maybeRunRequestMaintenance = (req) => {
    const path = String(req?.url || '');
    if (path === '/health' || path === '/health/ready') return;

    const now = Date.now();
    const candidates = Object.entries(maintenanceState)
        .filter(([, state]) => !state.running && (now - state.lastRunAt) >= state.minIntervalMs)
        .map(([taskName]) => taskName);

    if (candidates.length === 0) return;

    for (const taskName of candidates) {
        maintenanceState[taskName].running = true;
    }

    runMaintenanceTasks({
        requestedTasks: candidates,
        source: 'request_opportunistic',
        requestId: req?.headers?.['x-request-id'] || '',
    })
        .catch((error) => {
            logger.warn('vercel.request_maintenance_failed', {
                tasks: candidates,
                error: error.message,
            });
        })
        .finally(() => {
            const finishedAt = Date.now();
            for (const taskName of candidates) {
                maintenanceState[taskName].running = false;
                maintenanceState[taskName].lastRunAt = finishedAt;
            }
        });
};

module.exports = async (req, res) => {
    try {
        if (process.env.NODE_ENV === 'production' && splitRuntimeEnabled) {
            return res.status(503).json({
                status: 'error',
                message: 'Split runtime is enabled; deploy the long-lived backend service instead of the Vercel serverless adapter.',
                detail: 'split_runtime_requires_long_lived_backend',
                requestId: req?.headers?.['x-request-id'] || '',
            });
        }
        await ensureBootstrapped();
        maybeRunRequestMaintenance(req);
        return app(req, res);
    } catch (error) {
        res.statusCode = 500;
        return res.json({
            status: 'error',
            message: 'Backend initialization failed',
            detail: process.env.NODE_ENV === 'production' ? 'server_boot_failed' : error.message,
            requestId: req?.headers?.['x-request-id'] || '',
        });
    }
};

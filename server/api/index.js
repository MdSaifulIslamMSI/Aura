const mongoose = require('mongoose');
const app = require('../index');
const logger = require('../utils/logger');
const { initRedis } = require('../config/redis');
const { ensureSystemState } = require('../services/catalogService');

let bootPromise = null;

const connectMongo = async () => {
    if (mongoose.connection.readyState === 1) {
        return mongoose.connection;
    }

    if (!process.env.MONGO_URI) {
        throw new Error('MONGO_URI is required for backend deployment');
    }

    return mongoose.connect(process.env.MONGO_URI);
};

const ensureBootstrapped = async () => {
    if (bootPromise) return bootPromise;

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

module.exports = async (req, res) => {
    try {
        await ensureBootstrapped();
        return app(req, res);
    } catch (error) {
        res.statusCode = 500;
        return res.json({
            status: 'error',
            message: 'Backend initialization failed',
            detail: process.env.NODE_ENV === 'production' ? 'server_boot_failed' : error.message,
        });
    }
};

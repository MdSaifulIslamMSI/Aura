const dotenv = require('dotenv');
const mongoose = require('mongoose');

dotenv.config();

const connectDB = require('../config/db');
const logger = require('../utils/logger');
const { refreshFxRates } = require('../services/payments/fxRateService');

const main = async () => {
    await connectDB();

    try {
        const payload = await refreshFxRates({
            force: String(process.env.FX_REFRESH_FORCE || 'false').trim().toLowerCase() === 'true',
            trigger: 'script',
        });

        logger.info('fx.script_refresh_completed', {
            provider: payload.provider,
            fetchedAt: payload.fetchedAt,
            stale: payload.stale,
        });

        console.log(JSON.stringify({
            success: true,
            fx: payload,
        }, null, 2));
    } finally {
        await mongoose.connection.close(false);
    }
};

main().catch((error) => {
    logger.error('fx.script_refresh_failed', { error: error.message });
    process.exitCode = 1;
});

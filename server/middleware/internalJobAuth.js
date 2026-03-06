const AppError = require('../utils/AppError');
const logger = require('../utils/logger');

const requireInternalJobAuth = (req, res, next) => {
    const expectedSecret = String(process.env.CRON_SECRET || '').trim();
    const authHeader = String(req.headers.authorization || '').trim();

    if (!expectedSecret) {
        logger.error('internal_job_auth.misconfigured', {
            path: req.originalUrl,
            requestId: req.requestId || '',
        });
        return next(new AppError('Internal job authentication is not configured', 503));
    }

    if (authHeader !== `Bearer ${expectedSecret}`) {
        logger.warn('internal_job_auth.rejected', {
            path: req.originalUrl,
            requestId: req.requestId || '',
            userAgent: req.headers['user-agent'] || '',
        });
        return next(new AppError('Unauthorized internal job request', 401));
    }

    req.internalJob = {
        userAgent: req.headers['user-agent'] || '',
        source: String(req.headers['x-vercel-cron'] || 'authorized_client'),
    };

    return next();
};

module.exports = {
    requireInternalJobAuth,
};

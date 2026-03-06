const logger = require('../utils/logger');
const { notifyActivityFromRequest } = require('../services/email/activityEmailService');

const isActivityEmailMiddlewareEnabled = () => {
    if (process.env.NODE_ENV !== 'test') return true;
    return ['1', 'true', 'yes', 'on'].includes(String(process.env.TEST_ENABLE_ACTIVITY_EMAIL_MIDDLEWARE || '').trim().toLowerCase());
};

const activityEmailMiddleware = (req, res, next) => {
    if (!isActivityEmailMiddlewareEnabled()) {
        return next();
    }

    const startedAt = Date.now();

    res.on('finish', () => {
        notifyActivityFromRequest({
            req,
            res,
            durationMs: Date.now() - startedAt,
        }).catch((error) => {
            logger.error('activity_email.middleware_failed', {
                requestId: req.requestId || '',
                path: req.originalUrl,
                method: req.method,
                error: error.message,
            });
        });
    });

    next();
};

module.exports = activityEmailMiddleware;

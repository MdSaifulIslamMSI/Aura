const logger = require('../utils/logger');
const { notifyActivityFromRequest } = require('../services/email/activityEmailService');

const activityEmailMiddleware = (req, res, next) => {
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

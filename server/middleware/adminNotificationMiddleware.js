const logger = require('../utils/logger');
const { notifyAdminFromRequest } = require('../services/adminNotificationService');

const isAdminNotificationMiddlewareEnabled = () => {
    if (process.env.NODE_ENV !== 'test') return true;
    return ['1', 'true', 'yes', 'on'].includes(String(process.env.TEST_ENABLE_ADMIN_NOTIFICATION_MIDDLEWARE || '').trim().toLowerCase());
};

const adminNotificationMiddleware = (req, res, next) => {
    if (!isAdminNotificationMiddlewareEnabled()) {
        return next();
    }

    const startedAt = Date.now();

    res.on('finish', () => {
        notifyAdminFromRequest({
            req,
            res,
            durationMs: Date.now() - startedAt,
        }).catch((error) => {
            logger.error('admin_notification.middleware_failed', {
                requestId: req.requestId || '',
                path: req.originalUrl,
                method: req.method,
                error: error.message,
            });
        });
    });

    next();
};

module.exports = adminNotificationMiddleware;

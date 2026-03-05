const logger = require('../utils/logger');
const { notifyAdminFromRequest } = require('../services/adminNotificationService');

const adminNotificationMiddleware = (req, res, next) => {
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


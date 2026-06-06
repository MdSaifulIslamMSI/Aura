const { writeSecurityEvent } = require('../security/securityEventLogger');

const securityAuditMiddleware = (action, options = {}) => (req, res, next) => {
    const start = Date.now();
    res.on('finish', () => {
        const status = Number(res.statusCode || 0);
        const blocked = status >= 400;
        writeSecurityEvent({
            event: options.event || (blocked ? 'access.denied' : 'security.action.observed'),
            req,
            userId: req.user?._id || req.authSession?.userId || '',
            tenantId: req.user?.tenantId || '',
            action,
            riskScore: blocked ? 55 : 15,
            decision: blocked ? 'DENY' : 'ALLOW_WITH_AUDIT',
            reasonCode: blocked ? `http_${status}` : 'completed',
            metadata: {
                status,
                durationMs: Date.now() - start,
                ...options.metadata,
            },
        }, { level: blocked ? 'warn' : 'info' });
    });
    return next();
};

module.exports = {
    securityAuditMiddleware,
};

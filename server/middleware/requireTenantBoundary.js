const { writeSecurityEvent } = require('../security/securityEventLogger');

const same = (left, right) => String(left || '') === String(right || '');

const resolveTenant = (req = {}, resolver) => {
    if (typeof resolver === 'function') return resolver(req);
    return req.resource?.tenantId
        || req.params?.tenantId
        || req.body?.tenantId
        || req.query?.tenantId
        || '';
};

const requireTenantBoundary = (options = {}) => async (req, res, next) => {
    try {
        const actorTenantId = req.user?.tenantId || req.authSession?.tenantId || '';
        const resourceTenantId = await resolveTenant(req, options.resolveTenantId);
        if (actorTenantId && resourceTenantId && same(actorTenantId, resourceTenantId)) {
            return next();
        }

        writeSecurityEvent({
            event: 'access.crossTenantDenied',
            req,
            userId: req.user?._id || req.authSession?.userId || '',
            tenantId: actorTenantId,
            action: options.action || req.securityAction || '',
            riskScore: 75,
            decision: 'DENY',
            reasonCode: 'tenant_mismatch_or_missing',
            metadata: {
                hasActorTenant: Boolean(actorTenantId),
                hasResourceTenant: Boolean(resourceTenantId),
            },
        }, { level: 'warn' });

        res.set('Cache-Control', 'no-store');
        return res.status(options.hideResourceExistence ? 404 : 403).json({
            success: false,
            message: options.hideResourceExistence ? 'Resource not found' : 'Not authorized.',
            requestId: req.requestId || '',
        });
    } catch (error) {
        return next(error);
    }
};

module.exports = {
    requireTenantBoundary,
};

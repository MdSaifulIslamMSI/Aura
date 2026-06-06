const { verifyResourceAuthorization } = require('../security/resourceAuthorizationService');
const { writeSecurityEvent } = require('../security/securityEventLogger');

const defaultResolveResource = (req = {}) => req.resource || {
    id: req.params?.id || req.params?.resourceId || '',
    ownerId: req.params?.userId || req.body?.userId || req.body?.ownerId || '',
    tenantId: req.params?.tenantId || req.body?.tenantId || '',
};

const requireObjectOwnership = (options = {}) => async (req, res, next) => {
    try {
        const resource = typeof options.resolveResource === 'function'
            ? await options.resolveResource(req)
            : defaultResolveResource(req);
        const decision = verifyResourceAuthorization({
            actor: req.user || {},
            resource,
            resourceOwnerId: options.resourceOwnerId || resource?.ownerId || resource?.userId || '',
            requiredRole: options.requiredRole || '',
            allowAdminOverride: Boolean(options.allowAdminOverride),
            supportRedaction: options.supportRedaction !== false,
            resourceSensitivity: options.resourceSensitivity || 'medium',
        });
        req.objectOwnershipDecision = decision;

        writeSecurityEvent({
            event: decision.allowed ? 'access.resourceAllowed' : 'access.denied',
            req,
            userId: req.user?._id || req.authSession?.userId || '',
            tenantId: req.user?.tenantId || '',
            action: options.action || req.securityAction || '',
            riskScore: decision.allowed ? 20 : 70,
            decision: decision.allowed ? 'ALLOW_WITH_AUDIT' : 'DENY',
            reasonCode: decision.reasonCode,
            metadata: {
                redacted: decision.redacted,
                auditRequired: decision.auditRequired,
            },
        }, { level: decision.allowed ? 'info' : 'warn' });

        if (decision.allowed) return next();

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

const requireObjectOwnershipOrAdmin = (options = {}) => requireObjectOwnership({
    ...options,
    allowAdminOverride: true,
});

module.exports = {
    requireObjectOwnership,
    requireObjectOwnershipOrAdmin,
};

const AppError = require('../utils/AppError');
const {
    evaluateResourceAuthorization,
} = require('../security/authorizationPolicy');
const {
    recordSecurityAuditEvent,
} = require('../services/securityAuditService');

const authorizeResource = ({
    action = '',
    requiredRole = '',
    allowOwner = true,
    allowAdmin = false,
    requireTenantMatch = false,
    hideResourceExistence = false,
    resolveResource,
} = {}) => async (req, _res, next) => {
    try {
        const resource = typeof resolveResource === 'function'
            ? await resolveResource(req)
            : req.resource;
        const decision = evaluateResourceAuthorization({
            actor: req.user,
            resource,
            action,
            requiredRole,
            allowOwner,
            allowAdmin,
            requireTenantMatch,
        });
        req.resourceAuthorizationDecision = decision;

        recordSecurityAuditEvent({
            event: decision.allowed ? 'authorization.resource.allowed' : 'authorization.resource.denied',
            req,
            actorId: decision.actorUserId,
            action,
            resourceType: resource?.type || '',
            resourceId: resource?._id || resource?.id || '',
            result: decision.allowed ? 'allowed' : 'denied',
            reasonCode: decision.reasonCode,
            riskLevel: allowAdmin ? 'high' : 'medium',
            meta: {
                requiredRole,
                allowOwner,
                allowAdmin,
                requireTenantMatch,
            },
        });

        if (!decision.allowed) {
            const responseStatus = hideResourceExistence && [
                'owner_mismatch',
                'owner_missing',
                'resource_missing',
            ].includes(decision.reasonCode)
                ? 404
                : 403;
            const error = new AppError(
                responseStatus === 404 ? 'Resource not found' : 'Not authorized for this resource',
                responseStatus
            );
            error.code = String(decision.reasonCode || 'resource_authorization_denied').toUpperCase();
            return next(error);
        }

        return next();
    } catch (error) {
        return next(error);
    }
};

module.exports = {
    authorizeResource,
};

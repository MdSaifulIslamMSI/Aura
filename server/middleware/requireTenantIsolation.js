const { logSecurityDecisionEvent } = require('../security/securityEventLogger');
const { evaluateTenantIsolation } = require('../security/tenantGuard');
const { resolveSecurityFabricConfig } = require('../security/securityFabricConfig');
const { buildResourceFromOptions } = require('./requireSecurityDecision');

const requireTenantIsolation = (options = {}) => (req, res, next) => {
    try {
        const config = resolveSecurityFabricConfig();
        const evaluation = evaluateTenantIsolation({
            req,
            action: options.action || 'tenant.resource.write',
            resource: buildResourceFromOptions(req, {
                resourceType: options.resourceType || 'tenant_resource',
                resourceId: options.resourceId,
                resourceIdParam: options.resourceIdParam,
                resourceTenantId: options.resourceTenantId,
                resourceTenantIdParam: options.resourceTenantIdParam,
                actorTenantId: options.actorTenantId,
            }),
            config,
        });

        req.tenantGuardDecision = evaluation;
        logSecurityDecisionEvent({ req, evaluation, config });

        if (!evaluation.mismatch || config.auditOnly || !config.tenantGuardEnforce || !evaluation.enforceable) {
            return next();
        }

        return res.status(403).json({
            status: 'error',
            code: 'TENANT_ISOLATION_DENIED',
            message: 'Tenant isolation policy denied this request.',
            requestId: req.requestId || req.headers?.['x-request-id'] || '',
        });
    } catch (error) {
        return next(error);
    }
};

module.exports = {
    requireTenantIsolation,
};

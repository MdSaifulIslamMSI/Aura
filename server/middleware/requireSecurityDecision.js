const { evaluateSecurityPolicy } = require('../security/securityPolicyEngine');
const { logSecurityDecisionEvent } = require('../security/securityEventLogger');
const { SECURITY_DECISIONS } = require('../security/securityDecision');
const { resolveSecurityFabricConfig } = require('../security/securityFabricConfig');

const resolveOptionValue = (value, req) => {
    if (typeof value === 'function') return value(req);
    return value;
};

const buildResourceFromOptions = (req = {}, options = {}) => {
    const resourceIdParam = options.resourceIdParam;
    const resourceTenantIdParam = options.resourceTenantIdParam;

    return {
        type: resolveOptionValue(options.resourceType, req) || '',
        id: resolveOptionValue(options.resourceId, req)
            || (resourceIdParam ? req.params?.[resourceIdParam] : '')
            || '',
        tenantId: resolveOptionValue(options.resourceTenantId, req)
            || (resourceTenantIdParam ? req.params?.[resourceTenantIdParam] : '')
            || '',
        ownerTenantId: resolveOptionValue(options.ownerTenantId, req) || '',
        actorTenantId: resolveOptionValue(options.actorTenantId, req) || '',
    };
};

const sendSecurityDecisionResponse = (req, res, evaluation = {}) => {
    const body = {
        status: 'error',
        code: evaluation.decision,
        message: 'Security policy requires additional review for this request.',
        requiredControls: evaluation.requiredControls || [],
        requestId: req.requestId || req.headers?.['x-request-id'] || '',
    };

    if (evaluation.decision === SECURITY_DECISIONS.STEP_UP) {
        return res.status(428).json({
            ...body,
            code: 'STEP_UP_REQUIRED',
            message: 'Additional verification is required for this action.',
        });
    }

    if (evaluation.decision === SECURITY_DECISIONS.DENY) {
        return res.status(403).json({
            ...body,
            code: 'SECURITY_POLICY_DENIED',
            message: 'Security policy denied this request.',
        });
    }

    if (evaluation.decision === SECURITY_DECISIONS.LOCKDOWN) {
        return res.status(423).json({
            ...body,
            code: 'SECURITY_LOCKDOWN',
            message: 'Security lockdown is active for this action.',
        });
    }

    return null;
};

const requireSecurityDecision = (action, options = {}) => async (req, res, next) => {
    try {
        const config = resolveSecurityFabricConfig();
        const evaluation = evaluateSecurityPolicy({
            req,
            action,
            resource: buildResourceFromOptions(req, options),
            signals: resolveOptionValue(options.signals, req) || {},
            config,
            forceAuditRequired: Boolean(options.forceAuditRequired),
        });

        req.securityDecision = evaluation;
        logSecurityDecisionEvent({ req, evaluation, config });

        if (!config.enabled || config.auditOnly || !config.enforce || !evaluation.enforceable) {
            return next();
        }

        const response = sendSecurityDecisionResponse(req, res, evaluation);
        if (response) return response;

        return next();
    } catch (error) {
        return next(error);
    }
};

module.exports = {
    buildResourceFromOptions,
    requireSecurityDecision,
    sendSecurityDecisionResponse,
};

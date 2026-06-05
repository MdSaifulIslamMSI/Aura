const { buildRequestSecurityContext } = require('./requestSecurityContext');
const { SECURITY_DECISIONS, createSecurityDecision } = require('./securityDecision');
const { resolveSecurityFabricConfig } = require('./securityFabricConfig');

const normalizeTenant = (value = '') => String(value || '').trim();

const hasTenantMismatch = ({ actorTenantId = '', resourceTenantId = '' } = {}) => {
    const actorTenant = normalizeTenant(actorTenantId);
    const resourceTenant = normalizeTenant(resourceTenantId);
    return Boolean(actorTenant && resourceTenant && actorTenant !== resourceTenant);
};

const evaluateTenantIsolation = ({
    req = {},
    action = 'tenant.resource.write',
    resource = {},
    config = resolveSecurityFabricConfig(),
} = {}) => {
    const context = buildRequestSecurityContext(req, { action, resource });
    const actorTenantId = normalizeTenant(context.tenantId || resource.actorTenantId);
    const resourceTenantId = normalizeTenant(resource.tenantId || resource.resourceTenantId);
    const mismatch = hasTenantMismatch({ actorTenantId, resourceTenantId });

    const decisionModel = createSecurityDecision({
        decision: mismatch ? SECURITY_DECISIONS.DENY : SECURITY_DECISIONS.ALLOW,
        riskScore: mismatch ? 85 : 0,
        reasons: mismatch ? ['tenant_mismatch'] : ['tenant_match_or_not_applicable'],
        requiredControls: mismatch ? ['tenant_isolation'] : [],
        auditRequired: mismatch,
        enforceable: Boolean(mismatch && config.tenantGuardEnforce && !config.auditOnly),
    });

    return {
        action,
        context: {
            ...context,
            tenantId: actorTenantId,
        },
        decision: decisionModel.decision,
        decisionModel,
        riskScore: decisionModel.riskScore,
        reasons: decisionModel.reasons,
        requiredControls: decisionModel.requiredControls,
        auditRequired: decisionModel.auditRequired,
        auditOnly: config.auditOnly,
        enforceable: decisionModel.enforceable,
        actorTenantId,
        resourceTenantId,
        mismatch,
    };
};

module.exports = {
    evaluateTenantIsolation,
    hasTenantMismatch,
};

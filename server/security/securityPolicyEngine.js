const {
    SENSITIVITY_LEVELS,
    getActionDefinition,
} = require('./actionSensitivityRegistry');
const { evaluateAuraSecurityBrain } = require('./auraSecurityBrain');
const { getCurrentMode, recordCriticalSecurityDecision } = require('./incidentModeService');
const { buildRequestSecurityContext } = require('./requestSecurityContext');
const { SECURITY_DECISIONS, createSecurityDecision } = require('./securityDecision');
const { resolveSecurityFabricConfig } = require('./securityFabricConfig');

const buildFallbackActionDefinition = (action = '') => ({
    action: String(action || 'unknown.action').trim() || 'unknown.action',
    sensitivity: SENSITIVITY_LEVELS.MEDIUM,
    requiresAuth: false,
    requiresTenant: false,
    requiresFreshMfa: false,
    requiresTrustedDevice: false,
    requiresAudit: true,
    defaultDecision: SECURITY_DECISIONS.AUDIT,
    description: 'Unregistered security fabric action.',
});

const resolveResource = (resource = {}) => ({
    type: resource.type || resource.resourceType || '',
    id: resource.id || resource.resourceId || '',
    tenantId: resource.tenantId || resource.resourceTenantId || '',
    ownerTenantId: resource.ownerTenantId || '',
    actorTenantId: resource.actorTenantId || '',
});

const evaluateSecurityPolicy = ({
    req = {},
    action = '',
    resource = {},
    signals = {},
    config = resolveSecurityFabricConfig(),
    forceAuditRequired = false,
} = {}) => {
    const normalizedResource = resolveResource(resource);
    const context = buildRequestSecurityContext(req, { action, resource: normalizedResource });
    const actionDefinition = getActionDefinition(action) || buildFallbackActionDefinition(action);

    if (!config.enabled) {
        const disabledDecision = createSecurityDecision({
            decision: SECURITY_DECISIONS.ALLOW,
            riskScore: 0,
            reasons: ['security_fabric_disabled'],
            auditRequired: false,
            enforceable: false,
        });
        return {
            action: actionDefinition.action,
            context,
            actionDefinition,
            decision: disabledDecision.decision,
            decisionModel: disabledDecision,
            riskScore: disabledDecision.riskScore,
            reasons: disabledDecision.reasons,
            requiredControls: disabledDecision.requiredControls,
            auditRequired: disabledDecision.auditRequired,
            auditOnly: config.auditOnly,
            enforceable: false,
        };
    }

    const incidentMode = config.incidentModeEnabled ? getCurrentMode() : 'normal';
    const decisionModel = evaluateAuraSecurityBrain({
        actionDefinition,
        context,
        resource: normalizedResource,
        signals,
        incidentMode,
        config,
    });

    if (config.incidentModeEnabled && decisionModel.riskScore >= 80) {
        recordCriticalSecurityDecision({
            action: actionDefinition.action,
            decision: decisionModel,
            context,
        });
    }

    const auditRequired = Boolean(forceAuditRequired || decisionModel.auditRequired);

    return {
        action: actionDefinition.action,
        context,
        actionDefinition,
        decision: decisionModel.decision,
        decisionModel: {
            ...decisionModel,
            auditRequired,
        },
        riskScore: decisionModel.riskScore,
        reasons: decisionModel.reasons,
        requiredControls: decisionModel.requiredControls,
        auditRequired,
        auditOnly: config.auditOnly,
        enforceable: decisionModel.enforceable,
    };
};

module.exports = {
    buildFallbackActionDefinition,
    evaluateSecurityPolicy,
};

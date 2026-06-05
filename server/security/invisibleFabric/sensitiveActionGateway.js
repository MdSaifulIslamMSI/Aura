const { authorizeResource } = require('./resourceAuthorization');
const { assertReplayGuard } = require('./replayGuard');
const { recordSecurityAuditEvent } = require('../../services/securityAuditService');

const normalizeText = (value = '') => String(value || '').trim();

const normalizeSensitiveActionContract = (contract = {}) => ({
    intent: normalizeText(contract.intent),
    resourceType: normalizeText(contract.resourceType),
    resourceId: normalizeText(contract.resourceId),
    payload: contract.payload && typeof contract.payload === 'object' ? contract.payload : {},
    clientContext: contract.clientContext && typeof contract.clientContext === 'object'
        ? contract.clientContext
        : {},
});

const evaluateSensitiveActionGateway = async ({
    actor = {},
    resource = {},
    contract = {},
    context = {},
    execute,
} = {}) => {
    const normalized = normalizeSensitiveActionContract(contract);
    const action = normalized.intent.replace(/_/g, '.');
    const resourceForAuthz = {
        ...resource,
        type: resource.type || normalized.resourceType,
        id: resource.id || normalized.resourceId,
    };

    const authz = authorizeResource({
        actor,
        action,
        resource: resourceForAuthz,
        tenantId: context.tenantId,
        context,
    });
    if (!authz.allowed) {
        recordSecurityAuditEvent({
            event: 'invisible_fabric.sensitive_action.denied',
            req: context.req,
            actorId: actor._id || actor.id,
            action,
            resourceType: normalized.resourceType,
            resourceId: normalized.resourceId,
            result: 'denied',
            reasonCode: authz.reasonCode,
            riskLevel: 'high',
        });
        return { allowed: false, reasonCode: authz.reasonCode, response: { ok: false } };
    }

    if (context.replayGuardRequired) {
        const replay = await assertReplayGuard({
            actorId: actor._id || actor.id,
            sessionId: context.sessionId,
            intent: normalized.intent,
            resourceType: normalized.resourceType,
            resourceId: normalized.resourceId,
            nonce: normalized.clientContext.nonce,
            timestamp: normalized.clientContext.timestamp,
            ttlSeconds: context.replayTtlSeconds || 300,
        });
        if (!replay.ok) {
            return { allowed: false, reasonCode: replay.reasons[0] || 'replay_guard_denied', response: { ok: false } };
        }
    }

    const result = typeof execute === 'function'
        ? await execute({ actor, resource: resourceForAuthz, contract: normalized, context })
        : { ok: true };

    recordSecurityAuditEvent({
        event: 'invisible_fabric.sensitive_action.allowed',
        req: context.req,
        actorId: actor._id || actor.id,
        action,
        resourceType: normalized.resourceType,
        resourceId: normalized.resourceId,
        result: 'allowed',
        reasonCode: authz.reasonCode,
        riskLevel: 'high',
    });

    return {
        allowed: true,
        reasonCode: authz.reasonCode,
        response: {
            ok: true,
            requestId: context.req?.requestId || normalized.clientContext.requestId || '',
            result: result?.publicResult || result,
        },
    };
};

module.exports = {
    evaluateSensitiveActionGateway,
    normalizeSensitiveActionContract,
};

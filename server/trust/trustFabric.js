const { getActionPolicy } = require('./policies/actionRegistry');
const {
    buildTrustDecision,
    createDecisionId,
    createEvidence,
} = require('./trustDecision');
const {
    normalizeActor,
    normalizeRequest,
    resolveTrustFabricConfig,
} = require('./trustContext');
const { evaluateIdentity } = require('./engines/identityEngine');
const { evaluateAuthorization } = require('./engines/authorizationEngine');
const { evaluateOwnership } = require('./engines/ownershipEngine');
const { evaluateResourceState } = require('./engines/resourceStateEngine');
const { evaluateSensitiveAction } = require('./engines/sensitiveActionEngine');
const { evaluateRisk } = require('./engines/riskEngine');
const {
    evaluateSystemHealth,
    resolveSystemHealth,
} = require('./engines/systemHealthEngine');
const {
    recordOwnershipMismatch,
    recordPaymentWebhookEvent,
} = require('./engines/rateSignalEngine');
const { buildResponseDecision } = require('./engines/responseDecisionEngine');
const { recordTrustMetric } = require('./metrics/trustMetrics');

const normalizeResource = (resource = null, policy = {}) => {
    if (!resource) {
        return {
            type: policy.resourceType || 'unknown',
            resourceType: policy.resourceType || 'unknown',
        };
    }
    return {
        ...resource,
        type: resource.type || resource.resourceType || policy.resourceType || 'unknown',
        resourceType: resource.resourceType || resource.type || policy.resourceType || 'unknown',
    };
};

const evaluate = async ({
    actor = null,
    action = '',
    resource = null,
    request = {},
    session = null,
    device = null,
    system = null,
    mode = '',
    config: configOverrides = {},
    rateSignals = {},
} = {}) => {
    const configInput = { ...configOverrides };
    if (mode) configInput.mode = mode;
    const config = resolveTrustFabricConfig(process.env, configInput);
    const policy = getActionPolicy(action);
    const normalizedActor = normalizeActor(actor);
    const normalizedRequest = normalizeRequest(request);
    const normalizedResource = normalizeResource(resource, policy);
    const decisionId = createDecisionId();
    const evidence = createEvidence({
        actor: normalizedActor,
        action: policy.action || action,
        resource: normalizedResource,
        request: normalizedRequest,
        decisionId,
    });
    const baseMetadata = {
        actorRole: normalizedActor.role,
        policyAction: policy.action,
        policyUnknown: Boolean(policy.unknownAction),
        method: normalizedRequest.method,
    };

    if (!config.enabled || config.mode === 'off') {
        const decision = buildTrustDecision({
            decision: 'ALLOW',
            reason: 'TRUST_FABRIC_OFF',
            audit: false,
            enforcementMode: 'off',
            evidence,
            metadata: baseMetadata,
        });
        if (config.metricsEnabled) recordTrustMetric({ decision });
        return decision;
    }

    const identity = evaluateIdentity({ actor: normalizedActor, policy });
    const effectiveActor = identity.actor || normalizedActor;
    const authorization = evaluateAuthorization({ actor: effectiveActor, policy });
    const ownership = evaluateOwnership({
        actor: effectiveActor,
        resource: normalizedResource,
        policy,
    });
    const mergedRateSignals = { ...rateSignals };

    if (!ownership.ok && ownership.reason === 'RESOURCE_OWNERSHIP_MISMATCH') {
        try {
            const mismatchCount = await recordOwnershipMismatch({
                actorId: effectiveActor.id || 'anonymous',
                route: normalizedRequest.route || policy.action,
            });
            mergedRateSignals.ownershipMismatchCount = Math.max(
                Number(mergedRateSignals.ownershipMismatchCount || 0),
                mismatchCount
            );
        } catch {
            // Signal tracking must not change authz behavior.
        }
    }

    if (normalizedResource.eventId && policy.action === 'payment.webhook.process') {
        try {
            const webhookSignal = await recordPaymentWebhookEvent({
                eventId: normalizedResource.eventId,
                provider: normalizedResource.provider || 'payment',
            });
            mergedRateSignals.paymentWebhookReplayCount = Math.max(
                Number(mergedRateSignals.paymentWebhookReplayCount || 0),
                webhookSignal.duplicate ? 1 : 0
            );
        } catch {
            // Signal tracking must not change webhook behavior.
        }
    }

    const resourceState = evaluateResourceState({ resource: normalizedResource, policy });
    const sensitiveAction = evaluateSensitiveAction({
        actor: effectiveActor,
        session,
        policy,
    });
    const resolvedHealth = await resolveSystemHealth({
        system,
        readLive: Boolean(config.readLiveHealth),
    });
    const systemHealth = evaluateSystemHealth({
        systemHealth: resolvedHealth,
        policy,
    });
    const risk = evaluateRisk({
        actor: effectiveActor,
        policy,
        request: normalizedRequest,
        session,
        device,
        resource: normalizedResource,
        rateSignals: mergedRateSignals,
        systemHealth: resolvedHealth,
        sensitiveAction,
    });

    const decision = buildResponseDecision({
        mode: config.mode,
        config,
        policy,
        evidence,
        identity,
        authorization,
        ownership,
        resourceState,
        sensitiveAction,
        systemHealth,
        risk,
        metadata: {
            ...baseMetadata,
            riskFactors: risk.factors || [],
            resourceState: resourceState.state || '',
            systemMode: resolvedHealth.mode || 'standard',
        },
    });
    decision.audit = Boolean(config.auditEnabled && policy.audit !== false && decision.audit);

    if (config.metricsEnabled) recordTrustMetric({ decision });
    return decision;
};

module.exports = {
    evaluate,
};

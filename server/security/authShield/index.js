const { resolveAuthShieldConfig } = require('./config');
const { verifyIdentity } = require('./identityVerifier');
const { buildSessionContext } = require('./sessionContext');
const { verifyDeviceTrust } = require('./deviceTrust');
const { verifyRequestProof } = require('./dpopVerifier');
const { checkReplay } = require('./replayGuard');
const relationshipAuthz = require('./relationshipAuthz');
const { evaluateRisk, recordDeniedDecision } = require('./riskEngine');
const { getSensitiveAction, matchesAnyPattern } = require('./sensitiveActionRegistry');
const { requireStepUp } = require('./stepUpService');
const { decide } = require('./policyDecisionPoint');
const { writeDecisionAudit } = require('./auditWriter');
const {
    DECISIONS,
    normalizeAction,
    normalizeSensitivity,
} = require('./types');

const shouldFailClosed = ({ actionPolicy = {}, config = {} } = {}) => (
    Boolean(actionPolicy.failClosed)
    || matchesAnyPattern(actionPolicy.action, config.failClosedActions || [])
    || matchesAnyPattern(actionPolicy.canonicalAction, config.failClosedActions || [])
);

const resolveResource = async (req = {}, options = {}) => {
    if (options.resource) return options.resource;
    if (typeof options.resourceResolver === 'function') {
        return options.resourceResolver(req);
    }
    return null;
};

const effectiveDecision = ({ rawDecision, config, failClosed }) => {
    if (rawDecision === DECISIONS.ALLOW) return DECISIONS.ALLOW;
    if (!config.enabled) return DECISIONS.SHADOW_DENY;
    if (config.shadowMode && !failClosed) return DECISIONS.SHADOW_DENY;
    return rawDecision;
};

const enforce = async (req = {}, options = {}) => {
    const config = resolveAuthShieldConfig(options.env || process.env);
    const actionPolicy = getSensitiveAction(options.action, options);
    const action = normalizeAction(actionPolicy.action || options.action || 'unknown');
    const sensitivity = normalizeSensitivity(options.sensitivity || actionPolicy.sensitivity);
    const failClosed = shouldFailClosed({ actionPolicy, config });
    let resource = null;
    let resourceError = null;

    try {
        resource = await resolveResource(req, options);
    } catch (error) {
        resourceError = error;
    }

    const identityResult = verifyIdentity(req, { action, sensitivity });
    const identity = identityResult.identity || {};
    const session = buildSessionContext(req, identity);
    const dpop = await verifyRequestProof({ req, session, sensitivity, config });
    const replay = await checkReplay({
        session,
        proof: dpop,
        config,
        sensitivity,
        requireNonce: Boolean(options.requireReplayNonce || actionPolicy.failClosed),
    });
    const device = verifyDeviceTrust({
        req,
        requireDeviceProof: Boolean(options.requireDeviceProof || actionPolicy.requireDeviceProof),
        config,
    });
    const relationship = resourceError
        ? { allowed: false, reason: 'resource_resolver_failed' }
        : relationshipAuthz.can(identity, actionPolicy.canonicalAction || action, resource, {
            allowAuthenticatedWithoutResource: Boolean(options.allowAuthenticatedWithoutResource),
        });
    const stepUp = await requireStepUp(req, actionPolicy.canonicalAction || action, sensitivity, {
        config,
        actionPolicy,
        requireFreshAuth: Boolean(options.requireFreshAuth),
    });
    const risk = evaluateRisk({
        identity,
        session,
        action,
        resource,
        relationship,
        replay,
        req,
        sensitivity,
        config,
    });
    const rawPolicyDecision = decide({
        identityResult,
        replay,
        dpop,
        device,
        relationship,
        risk,
        stepUp,
        action,
        sensitivity,
        policyFailure: resourceError,
    });
    const decision = effectiveDecision({
        rawDecision: rawPolicyDecision.decision,
        config,
        failClosed,
    });
    const reasons = [
        ...rawPolicyDecision.reasons,
        ...(resourceError ? ['resource_resolver_failed'] : []),
        ...(dpop.shadow ? dpop.reasons : []),
        ...(device.shadow ? device.reasons : []),
        ...(!config.enabled ? ['auth_shield_disabled'] : []),
        ...(config.shadowMode && decision === DECISIONS.SHADOW_DENY ? ['shadow_mode'] : []),
    ];
    const result = {
        decision,
        action,
        sensitivity,
        riskLevel: risk.level,
        reasons: [...new Set(reasons.filter(Boolean))],
        policyVersion: config.policyVersion,
        requestId: session.requestId,
        auditId: '',
        failClosed,
        shadowMode: Boolean(config.shadowMode),
        enforced: decision !== DECISIONS.ALLOW && decision !== DECISIONS.SHADOW_DENY,
    };

    try {
        const audit = await writeDecisionAudit({
            req,
            decision: result,
            identity,
            resource: resource || {},
            risk,
            config,
        });
        result.auditId = audit.auditId || '';
    } catch (error) {
        result.reasons.push('audit_writer_failed');
        if (config.enabled && config.auditFailClosedForCritical && failClosed) {
            result.decision = DECISIONS.DENY;
            result.enforced = true;
        }
    }

    if ([DECISIONS.DENY, DECISIONS.STEP_UP_REQUIRED].includes(result.decision)) {
        recordDeniedDecision(identity, action);
    }

    return result;
};

module.exports = {
    enforce,
    shouldFailClosed,
};

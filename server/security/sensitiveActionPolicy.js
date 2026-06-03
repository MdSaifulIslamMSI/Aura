const {
    classifySensitiveActionFromRequest,
    getCategoryPolicy,
    resolveSensitiveActionPolicyConfig,
    RISK_LEVELS,
} = require('../config/sensitiveActionPolicy');

const normalizeText = (value = '') => String(value || '').trim().toLowerCase();
const toId = (value = '') => String(value || '').trim();

const DENIAL_MESSAGES = Object.freeze({
    unauthenticated: 'sensitive_action_authentication_required',
    admin_required: 'admin_assurance_required',
    recent_auth_required: 'webauthn_recent_auth_required',
    webauthn_registration_required: 'webauthn_registration_required',
    webauthn_step_up_required: 'webauthn_step_up_required',
    break_glass_required: 'break_glass_required',
    policy_disabled: 'sensitive_action_policy_disabled',
});

const buildDecision = ({
    allowed,
    reason,
    requiredAssurance = [],
    action = 'unknown',
    category = '',
    riskLevel = RISK_LEVELS.LOW,
    telemetryCode = '',
    resourceType = '',
    actorUserId = '',
    rollbackAllowed = false,
} = {}) => ({
    allowed: Boolean(allowed),
    reason: reason || (allowed ? 'allowed' : 'denied'),
    requiredAssurance: [...new Set(requiredAssurance.filter(Boolean))],
    action,
    category,
    riskLevel,
    telemetryCode: telemetryCode || `security.policy.${allowed ? 'allowed' : 'denied'}.${reason || 'unknown'}`,
    resourceType,
    actorUserId: toId(actorUserId),
    rollbackAllowed: Boolean(rollbackAllowed),
});

const hasRole = (actor = {}, role = '') => {
    const requiredRole = normalizeText(role);
    if (!requiredRole) return false;
    if (requiredRole === 'admin' && actor.isAdmin === true) return true;

    const roles = [
        actor.role,
        ...(Array.isArray(actor.roles) ? actor.roles : []),
        ...(Array.isArray(actor.adminRoles) ? actor.adminRoles : []),
    ].map(normalizeText);

    return roles.includes(requiredRole);
};

const hasRegisteredWebAuthnCredential = (actor = {}) => (
    Array.isArray(actor.trustedDevices)
    && actor.trustedDevices.some((entry) => (
        normalizeText(entry?.method) === 'webauthn'
        || Boolean(toId(entry?.webauthnCredentialIdBase64Url))
        || Boolean(toId(entry?.credentialId))
    ))
);

const hasFreshWebAuthnStepUp = ({ actor = {}, context = {} } = {}) => {
    if (context.webAuthnStepUpFresh === true || context.freshWebAuthnStepUp === true) {
        return true;
    }

    const activeUntil = new Date(context.stepUpUntil || actor.stepUpUntil || 0);
    const hasActiveStepUp = Number.isFinite(activeUntil.getTime()) && activeUntil.getTime() > Date.now();
    const methods = [
        context.authMethod,
        context.deviceMethod,
        ...(Array.isArray(context.amr) ? context.amr : []),
        ...(Array.isArray(actor.amr) ? actor.amr : []),
    ].map(normalizeText);

    return hasActiveStepUp && methods.some((method) => method === 'webauthn' || method === 'passkey');
};

const hasRecentAuth = ({ context = {}, config = resolveSensitiveActionPolicyConfig() } = {}) => {
    if (context.recentAuth === true || context.authFresh === true) return true;
    if (context.stepUpFresh === true || context.webAuthnStepUpFresh === true) return true;

    const authAgeSeconds = Number(context.authAgeSeconds);
    if (!Number.isFinite(authAgeSeconds) || authAgeSeconds < 0) return false;

    return authAgeSeconds <= config.recentAuthWindowMinutes * 60;
};

const resolveActorFromRequest = (req = {}) => ({
    _id: req.user?._id || req.authSession?.userId || req.authUid || '',
    id: req.user?.id || req.user?._id || req.authSession?.userId || req.authUid || '',
    email: req.user?.email || req.authToken?.email || req.authSession?.email || '',
    isAdmin: Boolean(req.user?.isAdmin),
    role: req.user?.role || '',
    roles: req.user?.roles || [],
    adminRoles: req.user?.adminRoles || [],
    trustedDevices: req.user?.trustedDevices || [],
    amr: req.authSession?.amr || req.authToken?.amr || [],
});

const resolveContextFromRequest = (req = {}) => {
    const posture = req.authzPosture || {};
    return {
        authAgeSeconds: posture.authAgeSeconds,
        recentAuth: posture.fresh,
        stepUpFresh: posture.stepUpFresh,
        webAuthnStepUpFresh: posture.webAuthnStepUpFresh,
        freshWebAuthnStepUp: posture.freshWebAuthnStepUp,
        stepUpUntil: req.authSession?.stepUpUntil,
        amr: req.authSession?.amr || req.authToken?.amr || [],
        deviceMethod: req.authSession?.deviceMethod,
        authMethod: req.authToken?.firebase?.sign_in_second_factor,
        riskLevel: posture.riskHigh ? RISK_LEVELS.HIGH : RISK_LEVELS.LOW,
        breakGlass: req.headers?.['x-aura-break-glass'] === 'true',
    };
};

const evaluateSensitiveActionPolicy = ({
    action = 'unknown',
    category = '',
    riskLevel = RISK_LEVELS.LOW,
    actor = {},
    context = {},
    resource = {},
    env = process.env,
    config = resolveSensitiveActionPolicyConfig(env),
    resourceType = '',
} = {}) => {
    const categoryPolicy = getCategoryPolicy(category, config);
    const requiredAssurance = categoryPolicy.requiredAssurance;
    const actorUserId = toId(actor?._id || actor?.id || actor?.userId);

    if (!config.enabled) {
        return buildDecision({
            allowed: true,
            reason: DENIAL_MESSAGES.policy_disabled,
            requiredAssurance,
            action,
            category,
            riskLevel,
            resourceType,
            actorUserId,
        });
    }

    if (config.rollbackEnabled) {
        return buildDecision({
            allowed: true,
            reason: 'rollback_override',
            requiredAssurance,
            action,
            category,
            riskLevel,
            resourceType,
            actorUserId,
            rollbackAllowed: true,
        });
    }

    if (requiredAssurance.includes('authenticated') && !actorUserId) {
        return buildDecision({
            allowed: false,
            reason: DENIAL_MESSAGES.unauthenticated,
            requiredAssurance,
            action,
            category,
            riskLevel,
            resourceType,
            actorUserId,
        });
    }

    if (requiredAssurance.includes('admin') && !hasRole(actor, 'admin')) {
        return buildDecision({
            allowed: false,
            reason: DENIAL_MESSAGES.admin_required,
            requiredAssurance,
            action,
            category,
            riskLevel,
            resourceType,
            actorUserId,
        });
    }

    if (requiredAssurance.includes('recent_auth') && !hasRecentAuth({ context, config })) {
        return buildDecision({
            allowed: false,
            reason: DENIAL_MESSAGES.recent_auth_required,
            requiredAssurance,
            action,
            category,
            riskLevel,
            resourceType,
            actorUserId,
        });
    }

    if (requiredAssurance.includes('webauthn_registered') && !hasRegisteredWebAuthnCredential(actor)) {
        if (config.adminBreakGlassEnabled && context.breakGlass === true) {
            return buildDecision({
                allowed: true,
                reason: 'break_glass_allowed',
                requiredAssurance,
                action,
                category,
                riskLevel,
                resourceType,
                actorUserId,
                rollbackAllowed: true,
            });
        }

        return buildDecision({
            allowed: false,
            reason: DENIAL_MESSAGES.webauthn_registration_required,
            requiredAssurance,
            action,
            category,
            riskLevel,
            resourceType,
            actorUserId,
        });
    }

    if (requiredAssurance.includes('fresh_webauthn_step_up')
        && !hasFreshWebAuthnStepUp({ actor, context })) {
        return buildDecision({
            allowed: false,
            reason: DENIAL_MESSAGES.webauthn_step_up_required,
            requiredAssurance,
            action,
            category,
            riskLevel,
            resourceType,
            actorUserId,
        });
    }

    if (config.production && categoryPolicy.failClosedInProduction && requiredAssurance.length === 0) {
        return buildDecision({
            allowed: false,
            reason: 'policy_missing_required_assurance',
            requiredAssurance,
            action,
            category,
            riskLevel,
            resourceType,
            actorUserId,
        });
    }

    return buildDecision({
        allowed: true,
        reason: 'allowed',
        requiredAssurance,
        action,
        category,
        riskLevel,
        resourceType: resourceType || resource?.type || '',
        actorUserId,
    });
};

const evaluateSensitiveActionRequest = (req = {}, overrides = {}) => {
    const classified = overrides.classifiedAction
        || (overrides.action || overrides.category
            ? {
                action: overrides.action || 'request.sensitive',
                category: overrides.category || '',
                riskLevel: overrides.riskLevel || RISK_LEVELS.LOW,
                resourceType: overrides.resourceType || '',
            }
            : classifySensitiveActionFromRequest(req));
    if (!classified) {
        return buildDecision({
            allowed: true,
            reason: 'not_sensitive',
            action: overrides.action || 'request.standard',
            riskLevel: RISK_LEVELS.LOW,
        });
    }

    return evaluateSensitiveActionPolicy({
        action: overrides.action || classified.action,
        category: overrides.category || classified.category,
        riskLevel: overrides.riskLevel || classified.riskLevel,
        resourceType: overrides.resourceType || classified.resourceType,
        actor: overrides.actor || resolveActorFromRequest(req),
        context: {
            ...resolveContextFromRequest(req),
            ...(overrides.context || {}),
        },
        resource: overrides.resource || {},
        env: overrides.env || process.env,
        config: overrides.config,
    });
};

module.exports = {
    DENIAL_MESSAGES,
    buildDecision,
    evaluateSensitiveActionPolicy,
    evaluateSensitiveActionRequest,
    hasFreshWebAuthnStepUp,
    hasRecentAuth,
    hasRegisteredWebAuthnCredential,
    resolveActorFromRequest,
    resolveContextFromRequest,
};

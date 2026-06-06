const {
    ENFORCEMENT_MODES,
    normalizeMode,
} = require('./trustDecision');

const parseBoolean = (value, fallback = false) => {
    if (value === undefined || value === null || value === '') return fallback;
    if (typeof value === 'boolean') return value;
    const normalized = String(value).trim().toLowerCase();
    if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
    if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
    return fallback;
};

const resolveTrustFabricConfig = (env = process.env, overrides = {}) => {
    const enabled = typeof overrides.enabled === 'boolean'
        ? overrides.enabled
        : parseBoolean(env.AURA_TRUST_FABRIC_ENABLED, true);
    const mode = enabled
        ? normalizeMode(overrides.mode || env.AURA_TRUST_FABRIC_MODE || ENFORCEMENT_MODES.SHADOW)
        : ENFORCEMENT_MODES.OFF;

    return {
        enabled,
        mode,
        enforceOwnership: typeof overrides.enforceOwnership === 'boolean'
            ? overrides.enforceOwnership
            : parseBoolean(env.AURA_TRUST_FABRIC_ENFORCE_OWNERSHIP, false),
        enforceAdminStepUp: typeof overrides.enforceAdminStepUp === 'boolean'
            ? overrides.enforceAdminStepUp
            : parseBoolean(env.AURA_TRUST_FABRIC_ENFORCE_ADMIN_STEP_UP, false),
        enforceRisk: typeof overrides.enforceRisk === 'boolean'
            ? overrides.enforceRisk
            : parseBoolean(env.AURA_TRUST_FABRIC_ENFORCE_RISK, false),
        selfHealingEnabled: typeof overrides.selfHealingEnabled === 'boolean'
            ? overrides.selfHealingEnabled
            : parseBoolean(env.AURA_TRUST_FABRIC_SELF_HEALING_ENABLED, false),
        auditEnabled: typeof overrides.auditEnabled === 'boolean'
            ? overrides.auditEnabled
            : parseBoolean(env.AURA_TRUST_FABRIC_AUDIT_ENABLED, true),
        metricsEnabled: typeof overrides.metricsEnabled === 'boolean'
            ? overrides.metricsEnabled
            : parseBoolean(env.AURA_TRUST_FABRIC_METRICS_ENABLED, true),
        ...overrides,
        mode,
        enabled,
    };
};

const normalizeActor = (actor = null) => {
    if (!actor) {
        return {
            id: '',
            role: 'anonymous',
            roles: ['anonymous'],
            isAuthenticated: false,
        };
    }

    const rawRoles = [
        actor.role,
        ...(Array.isArray(actor.roles) ? actor.roles : []),
        ...(Array.isArray(actor.adminRoles) ? actor.adminRoles : []),
    ]
        .map((entry) => String(entry || '').trim().toLowerCase())
        .filter(Boolean);
    const hasSuperAdmin = rawRoles.includes('super_admin')
        || rawRoles.includes('super-admin')
        || rawRoles.includes('superadmin')
        || rawRoles.includes('SUPER_ADMIN'.toLowerCase());
    const primaryRole = actor.actorType === 'payment_webhook'
        ? 'payment_webhook'
        : actor.actorType === 'system'
            ? 'system'
            : hasSuperAdmin
                ? 'super_admin'
                : actor.isAdmin
                    ? 'admin'
                    : actor.isSeller
                        ? 'seller'
                        : rawRoles[0] || 'buyer';
    const roles = Array.from(new Set([
        primaryRole,
        ...rawRoles,
        actor.isAdmin ? 'admin' : '',
        actor.isSeller ? 'seller' : '',
    ].filter(Boolean)));

    return {
        ...actor,
        id: String(actor.actorId || actor.userId || actor._id || actor.id || actor.authUid || '').trim(),
        role: primaryRole,
        roles,
        isAuthenticated: Boolean(actor._id || actor.id || actor.userId || actor.authUid || actor.email || actor.actorType),
    };
};

const normalizeRequest = (request = {}) => ({
    requestId: String(request.requestId || request.id || request.headers?.['x-request-id'] || '').trim(),
    ip: String(request.ip || request.headers?.['x-forwarded-for'] || request.connection?.remoteAddress || '').trim(),
    userAgent: String(request.userAgent || request.headers?.['user-agent'] || '').trim(),
    route: String(request.route || request.originalUrl || request.url || request.path || '').split('?')[0],
    method: String(request.method || '').trim().toUpperCase(),
    headers: request.headers || {},
});

const buildTrustContext = (req = {}) => ({
    requestId: req.requestId || req.headers?.['x-request-id'] || '',
    actor: normalizeActor(req.user || req.actor || null),
    ip: req.ip || req.headers?.['x-forwarded-for'] || req.connection?.remoteAddress || '',
    userAgent: req.headers?.['user-agent'] || '',
    route: String(req.originalUrl || req.url || req.path || '').split('?')[0],
    method: req.method || '',
    session: req.authSession || req.session || null,
    device: req.trustedDevice || req.device || null,
    timestamp: new Date().toISOString(),
});

module.exports = {
    buildTrustContext,
    normalizeActor,
    normalizeRequest,
    parseBoolean,
    resolveTrustFabricConfig,
};

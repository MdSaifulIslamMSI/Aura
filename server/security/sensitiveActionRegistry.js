const {
    SENSITIVITY_LEVELS,
    normalizeAction,
    normalizeSensitivity,
} = require('./securityDecisionTypes');

const DEFAULT_RATE_LIMITS = Object.freeze({
    login: { windowMs: 5 * 60 * 1000, max: 8, progressive: true },
    otp: { windowMs: 5 * 60 * 1000, max: 5, progressive: true },
    mfa: { windowMs: 5 * 60 * 1000, max: 5, progressive: true },
    critical: { windowMs: 10 * 60 * 1000, max: 10, progressive: true },
    export: { windowMs: 60 * 60 * 1000, max: 3, progressive: true },
    upload: { windowMs: 15 * 60 * 1000, max: 20, progressive: true },
    webhook: { windowMs: 60 * 1000, max: 120, progressive: true },
    ai: { windowMs: 60 * 1000, max: 30, progressive: true },
});

const containmentPolicies = Object.freeze({
    none: [],
    accountProtection: ['require_step_up', 'increase_rate_limit_severity'],
    adminFreeze: ['require_step_up', 'freeze_admin_destructive_actions', 'emit_incident_event'],
    exportFreeze: ['require_step_up', 'freeze_exports', 'emit_incident_event'],
    uploadFreeze: ['freeze_uploads', 'increase_rate_limit_severity'],
    apiKeyFreeze: ['freeze_api_key_creation', 'require_step_up', 'emit_incident_event'],
    sessionRevoke: ['revoke_session', 'require_step_up', 'emit_incident_event'],
});

const base = ({
    sensitivity = SENSITIVITY_LEVELS.MEDIUM,
    requiresAuth = true,
    requiresFreshAuth = false,
    requiresMfa = false,
    requiresPasskeyForAdmin = false,
    requiresTenantBoundary = false,
    requiresOwnerCheck = false,
    requiresAudit = true,
    rateLimitPolicy = DEFAULT_RATE_LIMITS.critical,
    maxRiskAllowed = 70,
    containmentPolicy = containmentPolicies.accountProtection,
    allowedRoles = [],
    sizeLimitBytes = null,
    approvalThreshold = null,
} = {}) => Object.freeze({
    sensitivity: normalizeSensitivity(sensitivity),
    requiresAuth,
    requiresFreshAuth,
    requiresMfa,
    requiresPasskeyForAdmin,
    requiresTenantBoundary,
    requiresOwnerCheck,
    requiresAudit,
    rateLimitPolicy,
    maxRiskAllowed,
    containmentPolicy,
    allowedRoles,
    sizeLimitBytes,
    approvalThreshold,
});

const sensitiveActions = Object.freeze({
    'auth.login': base({
        sensitivity: 'medium',
        requiresAuth: false,
        requiresFreshAuth: false,
        requiresMfa: false,
        requiresAudit: true,
        rateLimitPolicy: DEFAULT_RATE_LIMITS.login,
        maxRiskAllowed: 85,
    }),
    'auth.mfa.challenge': base({
        sensitivity: 'high',
        requiresFreshAuth: false,
        requiresMfa: false,
        rateLimitPolicy: DEFAULT_RATE_LIMITS.mfa,
        maxRiskAllowed: 75,
    }),
    'auth.mfa.disable': base({
        sensitivity: 'critical',
        requiresFreshAuth: true,
        requiresMfa: true,
        rateLimitPolicy: DEFAULT_RATE_LIMITS.mfa,
        maxRiskAllowed: 55,
        containmentPolicy: containmentPolicies.sessionRevoke,
    }),
    'auth.passkey.add': base({
        sensitivity: 'critical',
        requiresFreshAuth: true,
        requiresMfa: true,
        maxRiskAllowed: 60,
    }),
    'auth.passkey.remove': base({
        sensitivity: 'critical',
        requiresFreshAuth: true,
        requiresMfa: true,
        maxRiskAllowed: 55,
        containmentPolicy: containmentPolicies.sessionRevoke,
    }),
    'auth.password.change': base({
        sensitivity: 'critical',
        requiresFreshAuth: true,
        requiresMfa: true,
        maxRiskAllowed: 60,
        containmentPolicy: containmentPolicies.sessionRevoke,
    }),
    'auth.email.change': base({
        sensitivity: 'critical',
        requiresFreshAuth: true,
        requiresMfa: true,
        maxRiskAllowed: 60,
        containmentPolicy: containmentPolicies.sessionRevoke,
    }),
    'session.revoke': base({
        sensitivity: 'high',
        requiresFreshAuth: true,
        maxRiskAllowed: 70,
    }),
    'admin.user.update': base({
        sensitivity: 'high',
        requiresFreshAuth: true,
        requiresMfa: true,
        requiresTenantBoundary: true,
        allowedRoles: ['admin'],
        maxRiskAllowed: 65,
        containmentPolicy: containmentPolicies.adminFreeze,
    }),
    'admin.user.ban': base({
        sensitivity: 'critical',
        requiresFreshAuth: true,
        requiresMfa: true,
        requiresPasskeyForAdmin: true,
        requiresTenantBoundary: true,
        allowedRoles: ['admin'],
        maxRiskAllowed: 55,
        containmentPolicy: containmentPolicies.adminFreeze,
    }),
    'admin.role.change': base({
        sensitivity: 'critical',
        requiresFreshAuth: true,
        requiresMfa: true,
        requiresPasskeyForAdmin: true,
        requiresTenantBoundary: true,
        allowedRoles: ['admin'],
        maxRiskAllowed: 50,
        containmentPolicy: containmentPolicies.adminFreeze,
    }),
    'admin.permission.change': base({
        sensitivity: 'critical',
        requiresFreshAuth: true,
        requiresMfa: true,
        requiresPasskeyForAdmin: true,
        requiresTenantBoundary: true,
        allowedRoles: ['admin'],
        maxRiskAllowed: 50,
        containmentPolicy: containmentPolicies.adminFreeze,
    }),
    'admin.impersonation.start': base({
        sensitivity: 'critical',
        requiresFreshAuth: true,
        requiresMfa: true,
        requiresPasskeyForAdmin: true,
        requiresAudit: true,
        allowedRoles: ['admin'],
        maxRiskAllowed: 45,
        containmentPolicy: containmentPolicies.adminFreeze,
    }),
    'payment.create': base({
        sensitivity: 'high',
        requiresFreshAuth: false,
        requiresOwnerCheck: true,
        rateLimitPolicy: DEFAULT_RATE_LIMITS.critical,
        maxRiskAllowed: 70,
    }),
    'payment.refund': base({
        sensitivity: 'critical',
        requiresFreshAuth: true,
        requiresMfa: true,
        allowedRoles: ['admin', 'support'],
        maxRiskAllowed: 50,
        approvalThreshold: { amountMinor: 500000 },
        containmentPolicy: containmentPolicies.adminFreeze,
    }),
    'payment.webhook.receive': base({
        sensitivity: 'critical',
        requiresAuth: false,
        requiresFreshAuth: false,
        requiresMfa: false,
        rateLimitPolicy: DEFAULT_RATE_LIMITS.webhook,
        maxRiskAllowed: 65,
        containmentPolicy: containmentPolicies.accountProtection,
    }),
    'order.cancel': base({
        sensitivity: 'high',
        requiresFreshAuth: true,
        requiresOwnerCheck: true,
        maxRiskAllowed: 70,
    }),
    'data.export': base({
        sensitivity: 'critical',
        requiresFreshAuth: true,
        requiresMfa: true,
        requiresTenantBoundary: true,
        rateLimitPolicy: DEFAULT_RATE_LIMITS.export,
        maxRiskAllowed: 45,
        sizeLimitBytes: 10 * 1024 * 1024,
        containmentPolicy: containmentPolicies.exportFreeze,
    }),
    'data.bulkread': base({
        sensitivity: 'high',
        requiresFreshAuth: true,
        requiresTenantBoundary: true,
        rateLimitPolicy: DEFAULT_RATE_LIMITS.export,
        maxRiskAllowed: 60,
    }),
    'upload.create': base({
        sensitivity: 'medium',
        requiresOwnerCheck: true,
        rateLimitPolicy: DEFAULT_RATE_LIMITS.upload,
        maxRiskAllowed: 75,
        sizeLimitBytes: 8 * 1024 * 1024,
        containmentPolicy: containmentPolicies.uploadFreeze,
    }),
    'upload.remotefetch': base({
        sensitivity: 'high',
        requiresOwnerCheck: true,
        rateLimitPolicy: DEFAULT_RATE_LIMITS.upload,
        maxRiskAllowed: 55,
        containmentPolicy: containmentPolicies.uploadFreeze,
    }),
    'apikey.create': base({
        sensitivity: 'critical',
        requiresFreshAuth: true,
        requiresMfa: true,
        requiresTenantBoundary: true,
        maxRiskAllowed: 50,
        containmentPolicy: containmentPolicies.apiKeyFreeze,
    }),
    'apikey.rotate': base({
        sensitivity: 'critical',
        requiresFreshAuth: true,
        requiresMfa: true,
        requiresTenantBoundary: true,
        maxRiskAllowed: 55,
        containmentPolicy: containmentPolicies.apiKeyFreeze,
    }),
    'apikey.revoke': base({
        sensitivity: 'high',
        requiresFreshAuth: true,
        requiresTenantBoundary: true,
        maxRiskAllowed: 65,
    }),
    'webhook.configure': base({
        sensitivity: 'critical',
        requiresFreshAuth: true,
        requiresMfa: true,
        requiresTenantBoundary: true,
        maxRiskAllowed: 50,
    }),
    'ai.privilegedaction': base({
        sensitivity: 'high',
        requiresFreshAuth: true,
        requiresOwnerCheck: true,
        rateLimitPolicy: DEFAULT_RATE_LIMITS.ai,
        maxRiskAllowed: 60,
    }),
    'tenant.update': base({
        sensitivity: 'critical',
        requiresFreshAuth: true,
        requiresMfa: true,
        requiresTenantBoundary: true,
        allowedRoles: ['admin', 'tenant_admin'],
        maxRiskAllowed: 50,
        containmentPolicy: containmentPolicies.adminFreeze,
    }),
    'tenant.delete': base({
        sensitivity: 'critical',
        requiresFreshAuth: true,
        requiresMfa: true,
        requiresPasskeyForAdmin: true,
        requiresTenantBoundary: true,
        allowedRoles: ['admin'],
        maxRiskAllowed: 40,
        containmentPolicy: containmentPolicies.adminFreeze,
    }),
    'database.maintenance': base({
        sensitivity: 'critical',
        requiresFreshAuth: true,
        requiresMfa: true,
        requiresPasskeyForAdmin: true,
        allowedRoles: ['admin'],
        maxRiskAllowed: 35,
        containmentPolicy: containmentPolicies.adminFreeze,
    }),
    'status.adminupdate': base({
        sensitivity: 'high',
        requiresFreshAuth: true,
        requiresMfa: true,
        allowedRoles: ['admin', 'support'],
        maxRiskAllowed: 60,
    }),
});

const ACTION_ALIASES = Object.freeze({
    'admin.user.role.update': 'admin.role.change',
    'admin.users.mutate': 'admin.user.update',
    'admin.security_config.change': 'admin.permission.change',
    'admin.analytics.export': 'data.export',
    'payment.refund.create': 'payment.refund',
    'auth.factor.change': 'auth.mfa.disable',
    'auth.recovery.change': 'auth.password.change',
    'upload.write': 'upload.create',
    'ai.tool.action': 'ai.privilegedaction',
    'ai.session.mutate': 'ai.privilegedaction',
    'api-key.create': 'apikey.create',
    'api-key.rotate': 'apikey.rotate',
    'api-key.revoke': 'apikey.revoke',
    'api.key.create': 'apikey.create',
    'api.key.rotate': 'apikey.rotate',
    'api.key.revoke': 'apikey.revoke',
});

const SENSITIVE_ACTION_PATTERNS = Object.freeze([
    /^admin\./,
    /^auth\.(mfa|passkey|password|email|role|permission)\./,
    /^payment\./,
    /^data\.(export|bulkread)/,
    /^upload\./,
    /^api[-.]?key\./,
    /^apikey\./,
    /^webhook\./,
    /^ai\.privileged/,
    /^tenant\./,
    /^database\./,
    /^status\.admin/,
    /(^|\.)delete$/,
    /(^|\.)refund$/,
]);

const canonicalizeAction = (action = '') => {
    const normalized = normalizeAction(action);
    return ACTION_ALIASES[normalized] || normalized;
};

const getSensitiveActionPolicy = (action = '') => {
    const canonical = canonicalizeAction(action);
    const policy = sensitiveActions[canonical];
    if (!policy) return null;
    return {
        action: canonical,
        ...policy,
    };
};

const isKnownSensitiveAction = (action = '') => Boolean(getSensitiveActionPolicy(action));

const looksSensitiveAction = (action = '') => {
    const canonical = canonicalizeAction(action);
    return SENSITIVE_ACTION_PATTERNS.some((pattern) => pattern.test(canonical));
};

const listSensitiveActions = () => Object.keys(sensitiveActions).sort();

module.exports = {
    ACTION_ALIASES,
    DEFAULT_RATE_LIMITS,
    SENSITIVE_ACTION_PATTERNS,
    canonicalizeAction,
    containmentPolicies,
    getSensitiveActionPolicy,
    isKnownSensitiveAction,
    listSensitiveActions,
    looksSensitiveAction,
    sensitiveActions,
};

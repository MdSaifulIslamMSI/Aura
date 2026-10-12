const { normalizeAction } = require('./types');

const DEFAULT_FAIL_CLOSED_ACTIONS = Object.freeze([
    'admin.*',
    'payment.*',
    'auth.mfa.*',
    'auth.password.*',
    'auth.email.*',
    'auth.role.*',
    'security.*',
]);

const parseBoolean = (value, fallback = false) => {
    if (value === undefined || value === null || value === '') return fallback;
    if (typeof value === 'boolean') return value;
    const normalized = String(value).trim().toLowerCase();
    if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
    if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
    return fallback;
};

const parsePositiveInt = (value, fallback, { min = 1, max = 86400 } = {}) => {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed)) return fallback;
    if (parsed < min) return min;
    if (parsed > max) return max;
    return parsed;
};

const parseActionList = (value, fallback = DEFAULT_FAIL_CLOSED_ACTIONS) => {
    const source = value === undefined || value === null || value === ''
        ? fallback
        : String(value).split(',');
    const parsed = source
        .map((entry) => normalizeAction(entry))
        .filter(Boolean);
    return parsed.length > 0 ? parsed : [...fallback];
};

const resolveAuthShieldConfig = (env = process.env) => ({
    // Fail-safe defaults: the authorization PDP runs ENFORCED unless an
    // operator explicitly opts into shadow observation. The previous defaults
    // (disabled + shadow) meant every deployment silently shipped the whole
    // sensitive-action authorization layer as observe-only. Explicit
    // AUTH_SHIELD_ENABLED=false or AUTH_SHIELD_SHADOW_MODE=true in production
    // is refused by the auth environment contract (authEnvironment.js).
    enabled: parseBoolean(env.AUTH_SHIELD_ENABLED, true),
    shadowMode: parseBoolean(env.AUTH_SHIELD_SHADOW_MODE, false),
    auditEnabled: parseBoolean(env.AUTH_SHIELD_AUDIT_ENABLED, true),
    auditFailClosedForCritical: parseBoolean(env.AUTH_SHIELD_AUDIT_FAIL_CLOSED_CRITICAL, false),
    replayGuardEnabled: parseBoolean(env.AUTH_SHIELD_REPLAY_GUARD_ENABLED, true),
    dpopEnabled: parseBoolean(env.AUTH_SHIELD_DPOP_ENABLED, false),
    deviceTrustEnabled: parseBoolean(env.AUTH_SHIELD_DEVICE_TRUST_ENABLED, false),
    stepUpEnabled: parseBoolean(env.AUTH_SHIELD_STEP_UP_ENABLED, false),
    riskEngineEnabled: parseBoolean(env.AUTH_SHIELD_RISK_ENGINE_ENABLED, true),
    failClosedActions: parseActionList(env.AUTH_SHIELD_FAIL_CLOSED_ACTIONS),
    stepUpTtlCriticalSeconds: parsePositiveInt(env.AUTH_SHIELD_STEP_UP_TTL_CRITICAL_SECONDS, 300, { min: 60, max: 3600 }),
    stepUpTtlHighSeconds: parsePositiveInt(env.AUTH_SHIELD_STEP_UP_TTL_HIGH_SECONDS, 900, { min: 60, max: 7200 }),
    replayTtlSeconds: parsePositiveInt(env.AUTH_SHIELD_REPLAY_TTL_SECONDS, 300, { min: 30, max: 3600 }),
    policyVersion: String(env.AUTH_SHIELD_POLICY_VERSION || '2026-06-05').trim() || '2026-06-05',
});

module.exports = {
    DEFAULT_FAIL_CLOSED_ACTIONS,
    parseActionList,
    parseBoolean,
    parsePositiveInt,
    resolveAuthShieldConfig,
};

const TRUE_VALUES = new Set(['1', 'true', 'yes', 'on']);
const FALSE_VALUES = new Set(['0', 'false', 'no', 'off']);
const RISK_ENGINE_MODES = Object.freeze(['off', 'monitor', 'enforce']);

const DEFAULT_LOGIN_RUNTIME_ENFORCEMENT = Object.freeze({
    riskEngineMode: 'monitor',
    authSecurityOutboxEnabled: false,
    privilegedJitAccessEnabled: false,
});

const ACTIVATION_SEQUENCE = Object.freeze([
    'observe_login_security_metrics',
    'enable_auth_security_outbox_in_staging',
    'run_auth_risk_engine_in_monitor_mode',
    'promote_risk_engine_to_enforce_after_threshold_review',
    'enable_privileged_jit_only_after_approval_workflow_exists',
]);

const safeString = (value, fallback = '') => String(value === undefined || value === null ? fallback : value).trim();

const parseBooleanFlag = (name, fallback = false) => {
    const normalized = safeString(process.env[name]).toLowerCase();
    if (TRUE_VALUES.has(normalized)) return true;
    if (FALSE_VALUES.has(normalized)) return false;
    return fallback;
};

const parseRiskEngineMode = () => {
    const normalized = safeString(
        process.env.AUTH_RISK_ENGINE_MODE,
        DEFAULT_LOGIN_RUNTIME_ENFORCEMENT.riskEngineMode
    ).toLowerCase();
    return RISK_ENGINE_MODES.includes(normalized)
        ? normalized
        : DEFAULT_LOGIN_RUNTIME_ENFORCEMENT.riskEngineMode;
};

const getLoginRuntimeEnforcementPolicy = () => {
    const riskEngineMode = parseRiskEngineMode();
    const authSecurityOutboxEnabled = parseBooleanFlag(
        'AUTH_SECURITY_OUTBOX_ENABLED',
        DEFAULT_LOGIN_RUNTIME_ENFORCEMENT.authSecurityOutboxEnabled
    );
    const privilegedJitAccessEnabled = parseBooleanFlag(
        'PRIVILEGED_JIT_ACCESS_ENABLED',
        DEFAULT_LOGIN_RUNTIME_ENFORCEMENT.privilegedJitAccessEnabled
    );

    return {
        riskEngineMode,
        riskEngineMonitorOnly: riskEngineMode === 'monitor',
        riskEngineEnforced: riskEngineMode === 'enforce',
        authSecurityOutboxEnabled,
        privilegedJitAccessEnabled,
        activationSequence: [...ACTIVATION_SEQUENCE],
    };
};

module.exports = {
    ACTIVATION_SEQUENCE,
    DEFAULT_LOGIN_RUNTIME_ENFORCEMENT,
    RISK_ENGINE_MODES,
    getLoginRuntimeEnforcementPolicy,
    parseBooleanFlag,
};

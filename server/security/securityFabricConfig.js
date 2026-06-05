const TRUE_VALUES = new Set(['1', 'true', 'yes', 'on']);
const FALSE_VALUES = new Set(['0', 'false', 'no', 'off']);

const parseBooleanEnv = (value, fallback = false) => {
    if (value === undefined || value === null || value === '') return fallback;
    if (typeof value === 'boolean') return value;
    const normalized = String(value).trim().toLowerCase();
    if (TRUE_VALUES.has(normalized)) return true;
    if (FALSE_VALUES.has(normalized)) return false;
    return fallback;
};

const resolveSecurityFabricConfig = (env = process.env) => {
    const enabled = parseBooleanEnv(env.AURA_SECURITY_FABRIC_ENABLED, false);
    const auditOnly = parseBooleanEnv(env.AURA_SECURITY_FABRIC_AUDIT_ONLY, true);
    const enforceRequested = parseBooleanEnv(env.AURA_SECURITY_FABRIC_ENFORCE, false);
    const securityBrainEnabled = parseBooleanEnv(env.AURA_SECURITY_BRAIN_ENABLED, false);
    const incidentModeEnabled = parseBooleanEnv(env.AURA_INCIDENT_MODE_ENABLED, false);

    const enforce = Boolean(enabled && !auditOnly && enforceRequested);

    return {
        enabled,
        auditOnly,
        enforce,
        securityBrainEnabled,
        securityBrainEnforce: Boolean(
            securityBrainEnabled
            && enforce
            && parseBooleanEnv(env.AURA_SECURITY_BRAIN_ENFORCE, false)
        ),
        sensitiveActionStepUpEnabled: parseBooleanEnv(
            env.AURA_SENSITIVE_ACTION_STEP_UP_ENABLED,
            false
        ),
        incidentModeEnabled,
        incidentModeEnforce: Boolean(
            incidentModeEnabled
            && enforce
            && parseBooleanEnv(env.AURA_INCIDENT_MODE_ENFORCE, false)
        ),
        tenantGuardEnforce: Boolean(
            enforce
            && parseBooleanEnv(env.AURA_TENANT_GUARD_ENFORCE, false)
        ),
        eventLoggingEnabled: parseBooleanEnv(env.AURA_SECURITY_EVENT_LOGGING_ENABLED, true),
        production: String(env.NODE_ENV || '').trim().toLowerCase() === 'production',
    };
};

module.exports = {
    parseBooleanEnv,
    resolveSecurityFabricConfig,
};

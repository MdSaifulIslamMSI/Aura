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

const resolveAlienOtpConfig = (env = process.env) => ({
    enabled: parseBoolean(env.ALIEN_OTP_ENABLED, false),
    loginEnabled: parseBoolean(env.ALIEN_OTP_LOGIN_ENABLED, false),
    sensitiveActionsEnabled: parseBoolean(env.ALIEN_OTP_SENSITIVE_ACTIONS_ENABLED, false),
    deviceBoundEnabled: parseBoolean(env.ALIEN_OTP_DEVICE_BOUND_ENABLED, false),
    dpopCompatEnabled: parseBoolean(env.ALIEN_OTP_DPOP_COMPAT_ENABLED, false),
    riskEngineEnabled: parseBoolean(env.ALIEN_OTP_RISK_ENGINE_ENABLED, false),
    strictMode: parseBoolean(env.ALIEN_OTP_STRICT_MODE, false),
    auditEnabled: parseBoolean(env.ALIEN_OTP_AUDIT_ENABLED, true),
    challengeTtlSeconds: parsePositiveInt(env.ALIEN_OTP_CHALLENGE_TTL_SECONDS, 60, { min: 30, max: 90 }),
    maxFailuresPerWindow: parsePositiveInt(env.ALIEN_OTP_MAX_FAILURES_PER_WINDOW, 5, { min: 1, max: 100 }),
    policyVersion: String(env.ALIEN_OTP_POLICY_VERSION || '2026-06-05').trim() || '2026-06-05',
});

const validateAlienOtpEnv = (env = process.env) => {
    const config = resolveAlienOtpConfig(env);
    const warnings = [];

    if (!config.enabled) {
        if (config.strictMode) warnings.push('ALIEN_OTP_STRICT_MODE=true has no effect while ALIEN_OTP_ENABLED=false');
        if (config.sensitiveActionsEnabled) warnings.push('ALIEN_OTP_SENSITIVE_ACTIONS_ENABLED=true has no effect while ALIEN_OTP_ENABLED=false');
        if (config.loginEnabled) warnings.push('ALIEN_OTP_LOGIN_ENABLED=true has no effect while ALIEN_OTP_ENABLED=false');
    }
    if (config.strictMode && !config.sensitiveActionsEnabled && !config.loginEnabled) {
        warnings.push('ALIEN_OTP_STRICT_MODE=true is configured without a protected ALIEN OTP surface');
    }

    return {
        config,
        valid: true,
        warnings,
    };
};

module.exports = {
    parseBoolean,
    parsePositiveInt,
    resolveAlienOtpConfig,
    validateAlienOtpEnv,
};

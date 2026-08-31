const { getDuoFlags } = require('./duoFlags');
const {
    parseBoolean,
    parsePositiveInteger,
    resolveMfaConfig,
    secretLooksStrong,
} = require('./mfaConfig');

const safeString = (value, fallback = '') => String(
    value === undefined || value === null ? fallback : value
).trim();

const isProductionRuntime = (env = process.env) => safeString(env.NODE_ENV).toLowerCase() === 'production';

const resolveAdminSecurityConfig = (env = process.env) => {
    const production = isProductionRuntime(env);
    const stateEngineV2 = parseBoolean(env.ADMIN_SECURITY_STATE_ENGINE_V2, false);
    const recoveryGrants = parseBoolean(env.ADMIN_RECOVERY_GRANTS, false);
    const passkeyEnrollment = parseBoolean(env.ADMIN_PASSKEY_ENROLLMENT, false);
    const passkeyChallenge = parseBoolean(env.ADMIN_PASSKEY_CHALLENGE, stateEngineV2);
    const mfa = resolveMfaConfig(env);
    const duo = getDuoFlags(env);

    return {
        production,
        stateEngineV2,
        recoveryGrants,
        passkeyEnrollment,
        passkeyChallenge,
        duoProvider: parseBoolean(env.ADMIN_DUO_PROVIDER, duo.enabled),
        requirePasskey: parseBoolean(env.ADMIN_REQUIRE_PASSKEY, production),
        assuranceEnforcement: parseBoolean(env.ADMIN_ASSURANCE_ENFORCEMENT, production),
        actionBoundAssurance: parseBoolean(env.ADMIN_ACTION_BOUND_ASSURANCE, production),
        legacyFactorRead: parseBoolean(env.ADMIN_LEGACY_FACTOR_READ, true),
        twoPersonRecoveryRequired: parseBoolean(env.ADMIN_RECOVERY_TWO_PERSON_REQUIRED, false),
        hashSecret: safeString(env.ADMIN_SECURITY_HASH_SECRET),
        recoveryCookieName: safeString(env.ADMIN_RECOVERY_COOKIE_NAME, 'aura_admin_recovery'),
        recoveryGrantTtlSeconds: parsePositiveInteger(
            env.ADMIN_RECOVERY_GRANT_TTL_SECONDS,
            10 * 60,
            { min: 60, max: 30 * 60 }
        ),
        recoveryAuthorityTtlSeconds: parsePositiveInteger(
            env.ADMIN_RECOVERY_AUTHORITY_TTL_SECONDS,
            5 * 60,
            { min: 60, max: 10 * 60 }
        ),
        freshPrimaryAuthSeconds: parsePositiveInteger(
            env.ADMIN_RECOVERY_FRESH_AUTH_SECONDS,
            10 * 60,
            { min: 60, max: 30 * 60 }
        ),
        assuranceTtlSeconds: parsePositiveInteger(
            env.ADMIN_ASSURANCE_TTL_SECONDS,
            10 * 60,
            { min: 60, max: 30 * 60 }
        ),
        rpId: safeString(env.AUTH_WEBAUTHN_RP_ID),
        origin: safeString(env.AUTH_WEBAUTHN_ORIGIN),
        userVerification: safeString(env.AUTH_WEBAUTHN_USER_VERIFICATION, 'required').toLowerCase(),
        mfa,
        duo,
    };
};

const validateAdminSecurityConfig = ({ env = process.env } = {}) => {
    const config = resolveAdminSecurityConfig(env);
    const failures = [];
    const warnings = [];
    const recoverySurfaceEnabled = config.recoveryGrants || config.passkeyEnrollment;

    if (config.passkeyEnrollment && !config.recoveryGrants) {
        failures.push('ADMIN_RECOVERY_GRANTS must be true when ADMIN_PASSKEY_ENROLLMENT=true');
    }
    if (recoverySurfaceEnabled && !config.stateEngineV2) {
        failures.push('ADMIN_SECURITY_STATE_ENGINE_V2 must be true before admin recovery is enabled');
    }
    if (config.stateEngineV2 && !secretLooksStrong(config.hashSecret)) {
        failures.push('ADMIN_SECURITY_HASH_SECRET must be at least 32 strong characters when the admin security state engine is enabled');
    }
    if ((config.passkeyEnrollment || config.passkeyChallenge) && (!config.mfa.enabled || !config.mfa.passkeyEnabled)) {
        failures.push('MFA_ENABLED and MFA_PASSKEY_ENABLED must be true when admin passkey flows are enabled');
    }
    if ((config.passkeyEnrollment || config.passkeyChallenge) && !config.rpId) {
        failures.push('AUTH_WEBAUTHN_RP_ID is required when admin passkey flows are enabled');
    }
    if ((config.passkeyEnrollment || config.passkeyChallenge) && !config.origin) {
        failures.push('AUTH_WEBAUTHN_ORIGIN is required when admin passkey flows are enabled');
    }
    if ((config.passkeyEnrollment || config.passkeyChallenge) && config.userVerification !== 'required') {
        failures.push('AUTH_WEBAUTHN_USER_VERIFICATION must be required for admin passkeys');
    }
    if (config.production && config.origin && !config.origin.startsWith('https://')) {
        failures.push('AUTH_WEBAUTHN_ORIGIN must use https in production');
    }
    if (config.production && config.stateEngineV2 && !config.assuranceEnforcement) {
        failures.push('ADMIN_ASSURANCE_ENFORCEMENT cannot be disabled in production while the V2 state engine is enabled');
    }
    if (
        config.production
        && recoverySurfaceEnabled
        && parseBoolean(env.AUTH_SESSION_ALLOW_MEMORY_FALLBACK, false)
    ) {
        failures.push('AUTH_SESSION_ALLOW_MEMORY_FALLBACK must be false for production admin recovery');
    }
    if (config.duoProvider && (!config.duo.enabled || !config.duo.configured)) {
        warnings.push('ADMIN_DUO_PROVIDER is enabled but Duo is not fully configured');
    }

    return {
        ok: failures.length === 0,
        safe: failures.length === 0,
        config,
        failures,
        warnings,
    };
};

const assertAdminSecurityConfig = (env = process.env) => {
    const result = validateAdminSecurityConfig({ env });
    if (isProductionRuntime(env) && !result.safe) {
        throw new Error(`admin_security_environment_invalid:${result.failures.join('; ')}`);
    }
    return result;
};

module.exports = {
    assertAdminSecurityConfig,
    resolveAdminSecurityConfig,
    validateAdminSecurityConfig,
};

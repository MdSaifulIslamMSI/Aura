const DEFAULT_ALLOWED_CLOCK_SKEW_SECONDS = 60;
const MAX_ALLOWED_CLOCK_SKEW_SECONDS = 300;
const DEFAULT_AUTH_COOKIE_NAME = 'aura_sid';
const SUPPORTED_AUTH_PROVIDERS = new Set(['legacy', 'keycloak']);
// Matches the staging-detection convention in
// server/scripts/assert_staging_smoke_safety.js: staging runs NODE_ENV=production
// but deliberately observes the PDP in shadow, so production-only refusals
// must not apply to it.
const STAGING_ENV_VALUES = new Set(['stage', 'staging', 'smoke-staging']);
const {
    resolveMfaConfig,
    validateMfaEnvironment,
} = require('./mfaConfig');
const KEYCLOAK_REQUIRED_ENV = [
    'AUTH_ISSUER_URL',
    'AUTH_CLIENT_ID',
    'AUTH_AUDIENCE',
    'AUTH_REDIRECT_URI',
    'AUTH_POST_LOGOUT_REDIRECT_URI',
];

const { safeString } = require('../utils/safeString');

const normalizeProvider = (value = '') => {
    const normalized = safeString(value || 'legacy').toLowerCase();
    if (normalized === 'firebase') return 'legacy';
    if (normalized === 'oidc' || normalized === 'enterprise_oidc') return 'keycloak';
    return normalized || 'legacy';
};

const parseBoolean = (value, fallback = false) => {
    if (value === undefined || value === null || value === '') return fallback;
    if (typeof value === 'boolean') return value;
    const normalized = safeString(value).toLowerCase();
    if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
    if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
    return fallback;
};

const parsePositiveInteger = (value, fallback, { min = 1, max = Number.MAX_SAFE_INTEGER } = {}) => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return fallback;
    const integer = Math.floor(parsed);
    if (integer < min) return fallback;
    return Math.min(integer, max);
};

const trimTrailingSlash = (value = '') => safeString(value).replace(/\/+$/, '');

const isProductionRuntime = (env = process.env) => safeString(env.NODE_ENV).toLowerCase() === 'production';

const isPlaceholderValue = (value = '') => {
    const normalized = safeString(value).toLowerCase();
    if (!normalized) return false;
    return /<[^>]+>|replace-with|change-?me|placeholder|your-|example\.(com|test|invalid)|\.example\b/.test(normalized);
};

const isLikelyUrl = (value = '') => /^https?:\/\/[^/\s]+/i.test(safeString(value));

const isHttpsUrl = (value = '') => {
    try {
        return new URL(safeString(value)).protocol === 'https:';
    } catch {
        return false;
    }
};

const buildKeycloakJwksUrl = (issuerUrl = '') => {
    const issuer = trimTrailingSlash(issuerUrl);
    return issuer ? `${issuer}/protocol/openid-connect/certs` : '';
};

const buildOidcDiscoveryUrl = (issuerUrl = '') => {
    const issuer = trimTrailingSlash(issuerUrl);
    return issuer ? `${issuer}/.well-known/openid-configuration` : '';
};

const resolveAuthEnvironment = (env = process.env) => {
    const provider = normalizeProvider(env.AUTH_PROVIDER);
    const issuerUrl = trimTrailingSlash(env.AUTH_ISSUER_URL);
    const clientId = safeString(env.AUTH_CLIENT_ID);
    const audience = safeString(env.AUTH_AUDIENCE || clientId);
    const jwksUrl = trimTrailingSlash(env.AUTH_JWKS_URL || buildKeycloakJwksUrl(issuerUrl));
    const clientType = safeString(env.AUTH_CLIENT_TYPE || 'confidential').toLowerCase();
    const allowedAlgorithms = safeString(env.AUTH_ALLOWED_JWT_ALGORITHMS || 'RS256')
        .split(',')
        .map((entry) => entry.trim().toUpperCase())
        .filter(Boolean);

    return {
        provider,
        issuerUrl,
        discoveryUrl: buildOidcDiscoveryUrl(issuerUrl),
        clientId,
        clientSecret: safeString(env.AUTH_CLIENT_SECRET),
        clientType,
        audience,
        jwksUrl,
        redirectUri: safeString(env.AUTH_REDIRECT_URI),
        postLogoutRedirectUri: safeString(env.AUTH_POST_LOGOUT_REDIRECT_URI),
        cookieName: safeString(env.AUTH_COOKIE_NAME || DEFAULT_AUTH_COOKIE_NAME),
        requireMfaForAdmin: parseBoolean(env.AUTH_REQUIRE_MFA_FOR_ADMIN, true),
        allowedClockSkewSeconds: parsePositiveInteger(
            env.AUTH_ALLOWED_CLOCK_SKEW_SECONDS,
            DEFAULT_ALLOWED_CLOCK_SKEW_SECONDS,
            { min: 0, max: MAX_ALLOWED_CLOCK_SKEW_SECONDS }
        ),
        rateLimits: {
            login: parsePositiveInteger(env.AUTH_RATE_LIMIT_LOGIN, 10, { min: 1, max: 10_000 }),
            passwordReset: parsePositiveInteger(env.AUTH_RATE_LIMIT_PASSWORD_RESET, 5, { min: 1, max: 10_000 }),
            signup: parsePositiveInteger(env.AUTH_RATE_LIMIT_SIGNUP, 5, { min: 1, max: 10_000 }),
            tokenRefresh: parsePositiveInteger(env.AUTH_RATE_LIMIT_TOKEN_REFRESH, 30, { min: 1, max: 10_000 }),
            mfaChallenge: parsePositiveInteger(env.AUTH_RATE_LIMIT_MFA_CHALLENGE, 10, { min: 1, max: 10_000 }),
        },
        allowedAlgorithms: allowedAlgorithms.length ? allowedAlgorithms : ['RS256'],
        mfa: resolveMfaConfig(env),
    };
};

const validateAuthEnvironment = ({
    env = process.env,
    runtimeEnv = env.NODE_ENV || 'development',
    allowPlaceholders = false,
} = {}) => {
    const config = resolveAuthEnvironment(env);
    const failures = [];
    const warnings = [];
    const production = safeString(runtimeEnv).toLowerCase() === 'production';
    const placeholderAllowed = Boolean(allowPlaceholders && !production);

    if (!SUPPORTED_AUTH_PROVIDERS.has(config.provider)) {
        failures.push(`AUTH_PROVIDER must be one of ${Array.from(SUPPORTED_AUTH_PROVIDERS).join(', ')}`);
    }

    if (config.provider === 'keycloak') {
        for (const key of KEYCLOAK_REQUIRED_ENV) {
            const value = safeString(env[key]);
            if (!value) {
                failures.push(`${key} is required when AUTH_PROVIDER=keycloak`);
                continue;
            }
            if (isPlaceholderValue(value)) {
                const message = `${key} must be replaced before production use`;
                if (placeholderAllowed) warnings.push(message);
                else failures.push(message);
            }
        }

        for (const [key, value] of [
            ['AUTH_ISSUER_URL', config.issuerUrl],
            ['AUTH_JWKS_URL', config.jwksUrl],
            ['AUTH_REDIRECT_URI', config.redirectUri],
            ['AUTH_POST_LOGOUT_REDIRECT_URI', config.postLogoutRedirectUri],
        ]) {
            if (value && !isPlaceholderValue(value) && !isLikelyUrl(value)) {
                failures.push(`${key} must be an absolute http(s) URL`);
            } else if (production && value && !isPlaceholderValue(value) && !isHttpsUrl(value)) {
                failures.push(`${key} must use https in production`);
            }
        }

        if (!config.jwksUrl) {
            failures.push('AUTH_JWKS_URL could not be derived from AUTH_ISSUER_URL');
        }

        if (config.clientType === 'confidential' && !config.clientSecret) {
            failures.push('AUTH_CLIENT_SECRET is required for confidential Keycloak clients');
        }

        if (config.clientType !== 'confidential' && !safeString(env.AUTH_OIDC_STATE_SECRET || env.AUTH_VAULT_SECRET)) {
            failures.push('AUTH_OIDC_STATE_SECRET or AUTH_VAULT_SECRET is required for public Keycloak clients');
        }

        if (config.clientSecret && isPlaceholderValue(config.clientSecret)) {
            const message = 'AUTH_CLIENT_SECRET must be replaced before production use';
            if (placeholderAllowed) warnings.push(message);
            else failures.push(message);
        }

        if (safeString(env.AUTH_OIDC_STATE_SECRET) && isPlaceholderValue(env.AUTH_OIDC_STATE_SECRET)) {
            const message = 'AUTH_OIDC_STATE_SECRET must be replaced before production use';
            if (placeholderAllowed) warnings.push(message);
            else failures.push(message);
        }

        if (!config.allowedAlgorithms.includes('RS256')) {
            failures.push('AUTH_ALLOWED_JWT_ALGORITHMS must include RS256 for the Keycloak integration');
        }
    }

    // The admin-MFA and lockout refusals are deliberately OUTSIDE the provider
    // block above. They were scoped to AUTH_PROVIDER=keycloak, which meant the
    // default (legacy Firebase) deployment could set MFA_REQUIRED_FOR_ADMINS
    // and AUTH_LOCKOUT_MODE to their unsafe values and still boot clean: the
    // operator would believe the contract was protecting them while it was
    // skipping the check entirely. These are provider-independent invariants.
    if (production && !config.requireMfaForAdmin) {
        failures.push('AUTH_REQUIRE_MFA_FOR_ADMIN=false is forbidden in production');
    }

    // The declarative admin-MFA flag must agree with the runtime switch
    // consumed by mfaPolicyService/trustedDeviceManagementService: a green
    // contract with AUTH_REQUIRE_MFA_FOR_ADMIN=true but
    // MFA_REQUIRED_FOR_ADMINS=false would declare protection the runtime
    // never enforces.
    if (production && config.requireMfaForAdmin && !config.mfa.requiredForAdmins) {
        failures.push('MFA_REQUIRED_FOR_ADMINS must be true when AUTH_REQUIRE_MFA_FOR_ADMIN=true in production');
    }

    // Brute-force lockout must not be fully off in production. Anything
    // other than monitor|enforce (including unset or misspelled modes,
    // which loginLockoutService silently folds back to off) fails closed
    // here. Lockout evaluation itself still fails open at runtime for
    // availability; the distributed rate limiters remain the hard cap.
    const lockoutMode = safeString(env.AUTH_LOCKOUT_MODE || 'off').toLowerCase();
    if (production && !['monitor', 'enforce'].includes(lockoutMode)) {
        failures.push('AUTH_LOCKOUT_MODE must be monitor or enforce in production (found off/unset/invalid)');
    }

    if (production && config.provider === 'legacy' && safeString(env.AUTH_PROVIDER) === '') {
        warnings.push('AUTH_PROVIDER is not set; production will remain on the legacy Firebase provider');
    }

    // DPoP sender-constraint is verify-if-bound only: the shipped clients do
    // not present proofs yet, so enforcement would outage production. Warn so
    // the rollout sequence (docs/adr/0005-dpop-rollout-sequence.md) stays
    // visible until clients bind.
    if (production && safeString(env.AUTH_DPOP_REQUIRED).toLowerCase() !== 'true') {
        warnings.push('AUTH_DPOP_REQUIRED is not enabled; bound sessions verify proofs but unbound tokens remain bearer tokens');
    }

    // The authorization PDP (Auth Shield) must run enforced in production.
    // Its code defaults are now fail-safe (enabled, non-shadow), so this only
    // refuses an EXPLICIT downgrade: an operator who deliberately disables the
    // PDP or asks for shadow mode in production must remove that line, not
    // inherit it. Relationship authz, replay guarding and risk evaluation on
    // admin/payment/auth mutations depend on this staying enforced.
    // Staging (APP_ENV=staging, which runs NODE_ENV=production) deliberately
    // observes in shadow so policy regressions surface before production —
    // the refusal applies to true production only.
    const isStagingTarget = STAGING_ENV_VALUES.has(safeString(env.APP_ENV).toLowerCase());
    const productionEnforcement = production && !isStagingTarget;
    const authShieldEnabledRaw = safeString(env.AUTH_SHIELD_ENABLED).toLowerCase();
    if (productionEnforcement && ['0', 'false', 'no', 'off'].includes(authShieldEnabledRaw)) {
        failures.push('AUTH_SHIELD_ENABLED=false is forbidden in production; the authorization PDP must stay enforced');
    }
    const authShieldShadowRaw = safeString(env.AUTH_SHIELD_SHADOW_MODE).toLowerCase();
    if (productionEnforcement && ['1', 'true', 'yes', 'on'].includes(authShieldShadowRaw)) {
        failures.push('AUTH_SHIELD_SHADOW_MODE=true is forbidden in production; shadow observation must not ship to production');
    }

    const mfaValidation = validateMfaEnvironment({
        env,
        runtimeEnv,
        allowPlaceholders,
    });
    failures.push(...mfaValidation.failures);
    warnings.push(...mfaValidation.warnings);

    const adminPasskeyRequired = parseBoolean(env.ADMIN_REQUIRE_PASSKEY, production);
    if (production && adminPasskeyRequired) {
        if (!config.mfa.enabled) {
            failures.push('MFA_ENABLED must be true when production admin passkeys are required');
        }
        if (!config.mfa.passkeyEnabled) {
            failures.push('MFA_PASSKEY_ENABLED must be true when production admin passkeys are required');
        }
    }

    return {
        ok: failures.length === 0,
        safe: failures.length === 0,
        provider: config.provider,
        production,
        config,
        failures,
        warnings,
    };
};

const assertAuthEnvironmentConfig = (env = process.env) => {
    const result = validateAuthEnvironment({
        env,
        runtimeEnv: env.NODE_ENV || 'development',
        allowPlaceholders: false,
    });

    if (isProductionRuntime(env) && !result.safe) {
        throw new Error(`auth_environment_invalid:${result.failures.join('; ')}`);
    }

    return result;
};

module.exports = {
    DEFAULT_AUTH_COOKIE_NAME,
    KEYCLOAK_REQUIRED_ENV,
    SUPPORTED_AUTH_PROVIDERS,
    assertAuthEnvironmentConfig,
    buildKeycloakJwksUrl,
    buildOidcDiscoveryUrl,
    isPlaceholderValue,
    normalizeProvider,
    resolveAuthEnvironment,
    validateAuthEnvironment,
};

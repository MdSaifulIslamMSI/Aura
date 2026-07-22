const { resolveAdminSecurityConfig, validateAdminSecurityConfig } = require('../config/adminSecurityConfig');
const { getDuoFlags } = require('../config/duoFlags');
const { hasObservedWebAuthnUserVerification } = require('./trustedDeviceAssuranceService');

const ADMIN_SECURITY_STATES = Object.freeze({
    NOT_AUTHENTICATED: 'NOT_AUTHENTICATED',
    ACCOUNT_DISABLED: 'ACCOUNT_DISABLED',
    EMAIL_VERIFICATION_REQUIRED: 'EMAIL_VERIFICATION_REQUIRED',
    NOT_AUTHORIZED_AS_ADMIN: 'NOT_AUTHORIZED_AS_ADMIN',
    PRIMARY_REAUTH_REQUIRED: 'PRIMARY_REAUTH_REQUIRED',
    ADMIN_ENROLLMENT_REQUIRED: 'ADMIN_ENROLLMENT_REQUIRED',
    ADMIN_CHALLENGE_REQUIRED: 'ADMIN_CHALLENGE_REQUIRED',
    ADMIN_VERIFIED: 'ADMIN_VERIFIED',
    ADMIN_RECOVERY_REQUIRED: 'ADMIN_RECOVERY_REQUIRED',
    ADMIN_PROVIDER_UNAVAILABLE: 'ADMIN_PROVIDER_UNAVAILABLE',
    ADMIN_SECURITY_CONFIGURATION_ERROR: 'ADMIN_SECURITY_CONFIGURATION_ERROR',
});

const normalize = (value) => String(value || '').trim();
const lower = (value) => normalize(value).toLowerCase();

const hasAdminRole = (user = null) => Boolean(
    user?.isAdmin
    || (Array.isArray(user?.adminRoles) && user.adminRoles.some((role) => (
        ['admin', 'super_admin', 'security_admin'].includes(lower(role))
    )))
);

const isActiveAccount = (user = null) => Boolean(
    user
    && user.softDeleted !== true
    && !['suspended', 'deleted'].includes(lower(user.accountState))
);

const isActiveDevice = (device = null, now = Date.now()) => {
    if (!device || device.revokedAt) return false;
    const expiresAt = device.expiresAt ? new Date(device.expiresAt).getTime() : 0;
    return !Number.isFinite(expiresAt) || expiresAt <= 0 || expiresAt > now;
};

const isVerifiedAdminPasskey = (device = null, now = Date.now(), { legacyFactorRead = true } = {}) => {
    if (!isActiveDevice(device, now)) return false;
    if (lower(device.method) !== 'webauthn') return false;
    if (!hasObservedWebAuthnUserVerification(device)) return false;
    const scope = lower(device.credentialScope);
    const eligibility = lower(device.adminEligibility);
    if (scope === 'admin' && eligibility === 'verified') return true;
    return Boolean(
        legacyFactorRead
        && scope === 'admin'
        && eligibility === 'legacy_candidate'
    );
};

const getVerifiedAdminPasskeys = (user = null, options = {}) => (
    Array.isArray(user?.trustedDevices)
        ? user.trustedDevices.filter((device) => isVerifiedAdminPasskey(device, Date.now(), options))
        : []
);

const getAuthAgeSeconds = (req = {}, now = Date.now()) => {
    const authTimeSeconds = Number(req.authSession?.authTimeSeconds || req.authToken?.auth_time || 0);
    if (!Number.isFinite(authTimeSeconds) || authTimeSeconds <= 0) return Number.POSITIVE_INFINITY;
    return Math.max(Math.floor(now / 1000) - authTimeSeconds, 0);
};

const hasFreshPasskeyAssurance = ({ req = {}, passkeys = [], now = Date.now() } = {}) => {
    const session = req.authSession || null;
    const currentDeviceId = normalize(session?.deviceId);
    const webAuthnStepUpUntil = new Date(session?.webAuthnStepUpUntil || 0).getTime();
    const amr = Array.isArray(session?.amr) ? session.amr.map(lower) : [];
    return Boolean(
        currentDeviceId
        && Number.isFinite(webAuthnStepUpUntil)
        && webAuthnStepUpUntil > now
        && amr.some((entry) => entry === 'webauthn' || entry === 'passkey')
        && passkeys.some((device) => normalize(device.deviceId) === currentDeviceId)
    );
};

const hasFreshDuoAssurance = ({ req = {}, duo = getDuoFlags(), now = Date.now() } = {}) => {
    if (!duo.enabled || !duo.configured) return false;
    const stepUpUntil = new Date(req.authSession?.stepUpUntil || 0).getTime();
    const amr = Array.isArray(req.authSession?.amr) ? req.authSession.amr.map(lower) : [];
    return Number.isFinite(stepUpUntil)
        && stepUpUntil > now
        && amr.some((entry) => entry === 'duo' || entry === 'duo_oidc');
};

const isAllowlistedAdmin = (user = null, env = process.env) => {
    const allowlist = new Set(
        normalize(env.ADMIN_ALLOWLIST_EMAILS)
            .split(',')
            .map(lower)
            .filter(Boolean)
    );
    const rawRequirement = lower(env.ADMIN_REQUIRE_ALLOWLIST);
    const requireAllowlist = rawRequirement
        ? ['1', 'true', 'yes', 'on'].includes(rawRequirement)
        : lower(env.NODE_ENV) === 'production';
    const email = lower(user?.email);
    if (requireAllowlist && allowlist.size === 0) return false;
    if (allowlist.size === 0) return true;
    return allowlist.has(email);
};

const resolveAdminSecurityState = ({
    req = {},
    user = req.user || null,
    recoveryAuthorityActive = false,
    env = process.env,
    now = Date.now(),
} = {}) => {
    const validation = validateAdminSecurityConfig({ env });
    const config = validation.config || resolveAdminSecurityConfig(env);
    const passkeys = getVerifiedAdminPasskeys(user, { legacyFactorRead: config.legacyFactorRead });
    const passkeyAssurance = hasFreshPasskeyAssurance({ req, passkeys, now });
    const duoAssurance = hasFreshDuoAssurance({ req, duo: config.duo, now });
    const duoCanSatisfyAdminEntry = Boolean(!config.requirePasskey && duoAssurance);
    const providerAvailable = Boolean(
        (config.passkeyChallenge && config.mfa.enabled && config.mfa.passkeyEnabled && config.rpId && config.origin)
        || (
            !config.requirePasskey
            && config.duoProvider
            && config.duo.enabled
            && config.duo.configured
        )
    );
    const emailVerified = Boolean(
        req.authIdentity?.emailVerified
        ?? req.authToken?.email_verified
        ?? user?.isVerified
    );
    const authAgeSeconds = getAuthAgeSeconds(req, now);

    let state = ADMIN_SECURITY_STATES.ADMIN_VERIFIED;
    let reason = 'verified';

    if (!user?._id) {
        state = ADMIN_SECURITY_STATES.NOT_AUTHENTICATED;
        reason = 'not_authenticated';
    } else if (!isActiveAccount(user)) {
        state = ADMIN_SECURITY_STATES.ACCOUNT_DISABLED;
        reason = 'account_disabled';
    } else if (!emailVerified) {
        state = ADMIN_SECURITY_STATES.EMAIL_VERIFICATION_REQUIRED;
        reason = 'email_verification_required';
    } else if (!hasAdminRole(user) || !isAllowlistedAdmin(user, env)) {
        state = ADMIN_SECURITY_STATES.NOT_AUTHORIZED_AS_ADMIN;
        reason = 'admin_authorization_required';
    } else if (!validation.safe && config.stateEngineV2) {
        state = ADMIN_SECURITY_STATES.ADMIN_SECURITY_CONFIGURATION_ERROR;
        reason = 'configuration_invalid';
    } else if (authAgeSeconds > config.freshPrimaryAuthSeconds) {
        state = ADMIN_SECURITY_STATES.PRIMARY_REAUTH_REQUIRED;
        reason = 'fresh_primary_auth_required';
    } else if (passkeyAssurance || duoCanSatisfyAdminEntry) {
        state = ADMIN_SECURITY_STATES.ADMIN_VERIFIED;
        reason = passkeyAssurance ? 'passkey_assurance_active' : 'duo_assurance_active';
    } else if (passkeys.length > 0) {
        state = providerAvailable
            ? ADMIN_SECURITY_STATES.ADMIN_CHALLENGE_REQUIRED
            : ADMIN_SECURITY_STATES.ADMIN_PROVIDER_UNAVAILABLE;
        reason = providerAvailable ? 'admin_challenge_required' : 'admin_provider_unavailable';
    } else if (recoveryAuthorityActive && config.passkeyEnrollment) {
        state = ADMIN_SECURITY_STATES.ADMIN_ENROLLMENT_REQUIRED;
        reason = 'recovery_authority_active';
    } else if (config.recoveryGrants) {
        state = ADMIN_SECURITY_STATES.ADMIN_RECOVERY_REQUIRED;
        reason = 'recovery_grant_required';
    } else if (!providerAvailable) {
        state = ADMIN_SECURITY_STATES.ADMIN_PROVIDER_UNAVAILABLE;
        reason = 'admin_provider_unavailable';
    } else {
        state = ADMIN_SECURITY_STATES.ADMIN_RECOVERY_REQUIRED;
        reason = 'admin_factor_missing';
    }

    return {
        enabled: config.stateEngineV2,
        state,
        reason,
        verified: state === ADMIN_SECURITY_STATES.ADMIN_VERIFIED,
        account: {
            authenticated: Boolean(user?._id),
            active: isActiveAccount(user),
            emailVerified,
            authorizedAdmin: Boolean(hasAdminRole(user) && isAllowlistedAdmin(user, env)),
        },
        adminSecurity: {
            approvedPasskeyCount: passkeys.length,
            passkeyAssuranceActive: passkeyAssurance,
            duoAssuranceActive: duoCanSatisfyAdminEntry,
            recoveryAuthorityActive: Boolean(recoveryAuthorityActive),
            assuranceExpiresAt: passkeyAssurance
                ? req.authSession?.webAuthnStepUpUntil || null
                : (duoCanSatisfyAdminEntry ? req.authSession?.stepUpUntil || null : null),
        },
        policy: {
            assuranceTtlSeconds: config.assuranceTtlSeconds,
            recoveryAuthorityTtlSeconds: config.recoveryAuthorityTtlSeconds,
            actionBoundAssurance: config.actionBoundAssurance,
            legacyFactorRead: config.legacyFactorRead,
        },
        actions: {
            allowAdminAccess: state === ADMIN_SECURITY_STATES.ADMIN_VERIFIED,
            canChallengePasskey: Boolean(config.passkeyChallenge && passkeys.length > 0),
            canUseDuo: Boolean(
                !config.requirePasskey
                && config.duoProvider
                && config.duo.enabled
                && config.duo.configured
            ),
            canExchangeRecoveryGrant: Boolean(config.recoveryGrants),
            canEnrollPasskey: Boolean(config.passkeyEnrollment && recoveryAuthorityActive),
            mustSignInAgain: state === ADMIN_SECURITY_STATES.PRIMARY_REAUTH_REQUIRED,
        },
        configuration: {
            safe: validation.safe,
            issueCount: validation.failures.length,
            warningCount: validation.warnings.length,
        },
    };
};

module.exports = {
    ADMIN_SECURITY_STATES,
    getAuthAgeSeconds,
    getVerifiedAdminPasskeys,
    hasFreshDuoAssurance,
    hasFreshPasskeyAssurance,
    isAllowlistedAdmin,
    resolveAdminSecurityState,
};

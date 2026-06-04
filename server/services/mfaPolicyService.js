const { resolveMfaConfig } = require('../config/mfaConfig');

const MFA_METHODS = Object.freeze({
    PASSKEY: 'passkey',
    TOTP: 'totp',
    RECOVERY_CODE: 'recovery_code',
    EMAIL_OTP: 'email_otp',
});

const METHOD_STRENGTH = Object.freeze({
    [MFA_METHODS.PASSKEY]: 4,
    [MFA_METHODS.TOTP]: 3,
    [MFA_METHODS.RECOVERY_CODE]: 2,
    [MFA_METHODS.EMAIL_OTP]: 1,
});

const normalizeText = (value) => String(value || '').trim().toLowerCase();

const hasAdminRole = (user = null, role = '') => (
    Array.isArray(user?.adminRoles)
    && user.adminRoles.map((entry) => normalizeText(entry)).includes(normalizeText(role))
);

const resolveRole = (user = null) => {
    if (hasAdminRole(user, 'SUPER_ADMIN')) return 'super_admin';
    if (user?.isAdmin) return 'admin';
    if (user?.isSeller) return 'seller';
    return 'buyer';
};

const hasPasskey = (user = null) => {
    const trustedDevicePasskey = Array.isArray(user?.trustedDevices)
        && user.trustedDevices.some((device) => (
            normalizeText(device?.method) === 'webauthn'
            || Boolean(String(device?.webauthnCredentialIdBase64Url || '').trim())
        ));
    const mfaPasskey = Array.isArray(user?.mfa?.passkeys)
        && user.mfa.passkeys.some((passkey) => !passkey?.revokedAt && String(passkey?.credentialId || '').trim());
    return Boolean(trustedDevicePasskey || mfaPasskey);
};

const hasTotp = (user = null) => Boolean(user?.mfa?.totp?.enabled && user?.mfa?.totp?.confirmedAt);

const getRecoveryCodeCount = (user = null) => Math.max(Number(user?.recoveryCodeState?.activeCount || 0), 0);

const hasRecoveryCodes = (user = null) => getRecoveryCodeCount(user) > 0;

const isHighRiskLogin = (context = {}) => {
    const riskLevel = normalizeText(context.riskLevel || context.risk?.level || context.loginRisk?.level);
    const riskState = normalizeText(context.riskState);
    return Boolean(
        context.suspiciousLogin
        || context.forceStepUp
        || riskLevel === 'high'
        || riskLevel === 'critical'
        || riskState === 'login_risk_high'
    );
};

const buildAllowedMethods = ({ user = null, config = resolveMfaConfig(), role = resolveRole(user), lowRiskBuyer = false } = {}) => {
    const methods = [];
    if (config.passkeyEnabled && hasPasskey(user)) methods.push(MFA_METHODS.PASSKEY);
    if (config.totpEnabled && hasTotp(user)) methods.push(MFA_METHODS.TOTP);
    if (config.recoveryCodesEnabled && hasRecoveryCodes(user)) methods.push(MFA_METHODS.RECOVERY_CODE);
    if (config.emailOtpFallbackEnabled && role === 'buyer' && lowRiskBuyer) methods.push(MFA_METHODS.EMAIL_OTP);
    return Array.from(new Set(methods));
};

const choosePreferredMethod = (methods = [], { role = 'buyer', passkeyAvailable = false } = {}) => {
    if ((role === 'super_admin' || role === 'admin') && methods.includes(MFA_METHODS.PASSKEY)) {
        return MFA_METHODS.PASSKEY;
    }
    if (passkeyAvailable && methods.includes(MFA_METHODS.PASSKEY)) return MFA_METHODS.PASSKEY;
    if (methods.includes(MFA_METHODS.TOTP)) return MFA_METHODS.TOTP;
    return methods[0] || null;
};

const evaluateLogin = ({ user = null, context = {}, env = process.env } = {}) => {
    const config = resolveMfaConfig(env);
    const role = resolveRole(user);
    const highRisk = isHighRiskLogin(context);
    const userEnabled = Boolean(user?.mfa?.enabled);
    const adminRequired = Boolean(config.requiredForAdmins && (role === 'admin' || role === 'super_admin'));
    const sellerRequired = Boolean(config.requiredForSellers && role === 'seller');
    const mfaRequired = Boolean(config.enabled && (userEnabled || adminRequired || sellerRequired || highRisk));
    const allowedMethods = mfaRequired
        ? buildAllowedMethods({ user, config, role, lowRiskBuyer: !highRisk && role === 'buyer' })
        : [];
    const preferredMethod = choosePreferredMethod(allowedMethods, {
        role,
        passkeyAvailable: hasPasskey(user),
    });

    const reason = !mfaRequired
        ? 'not_required'
        : highRisk
            ? 'suspicious_login'
            : adminRequired
                ? 'admin_policy'
                : sellerRequired
                    ? 'seller_policy'
                    : 'user_enabled';

    return {
        mfaRequired,
        freshMfaRequired: false,
        allowedMethods,
        preferredMethod,
        reason,
        block: Boolean(mfaRequired && allowedMethods.length === 0),
        role,
    };
};

const isFreshMfaSatisfied = ({ user = null, session = null, policy = {}, env = process.env } = {}) => {
    if (!policy?.freshMfaRequired) return true;
    const config = resolveMfaConfig(env);
    const lastMfaAt = user?.mfa?.lastMfaAt ? new Date(user.mfa.lastMfaAt).getTime() : 0;
    const stepUpUntil = session?.stepUpUntil ? new Date(session.stepUpUntil).getTime() : 0;
    const now = Date.now();
    const freshWindowMs = config.freshWindowSeconds * 1000;
    const recentUserMfa = Number.isFinite(lastMfaAt) && lastMfaAt > 0 && (now - lastMfaAt) <= freshWindowMs;
    const activeSessionStepUp = Number.isFinite(stepUpUntil) && stepUpUntil > now;
    const sessionAmr = Array.isArray(session?.amr)
        ? session.amr.map((entry) => normalizeText(entry))
        : [];
    const method = normalizeText(user?.mfa?.lastMfaMethod || '');

    if (policy.preferredMethod === MFA_METHODS.PASSKEY) {
        return Boolean(activeSessionStepUp && (sessionAmr.includes('webauthn') || sessionAmr.includes('passkey')));
    }

    return Boolean(
        activeSessionStepUp
        || (recentUserMfa && (!policy.allowedMethods?.length || policy.allowedMethods.includes(method)))
    );
};

const evaluateAction = ({ user = null, session = null, action = '', route = '', category = '', env = process.env } = {}) => {
    const config = resolveMfaConfig(env);
    const role = resolveRole(user);
    const dangerous = Boolean(action || route || category);
    const userEnabled = Boolean(user?.mfa?.enabled);
    const adminRequired = Boolean(config.requiredForAdmins && (role === 'admin' || role === 'super_admin'));
    const sellerRequired = Boolean(config.requiredForSellers && role === 'seller');
    const policyRequired = Boolean(userEnabled || adminRequired || sellerRequired);
    const candidateAllowedMethods = config.enabled && dangerous
        ? buildAllowedMethods({ user, config, role, lowRiskBuyer: false })
        : [];
    const freshMfaRequired = Boolean(config.enabled && dangerous && (
        candidateAllowedMethods.length > 0
        || policyRequired
    ));
    const allowedMethods = freshMfaRequired ? candidateAllowedMethods : [];
    const passkeyPreferred = role === 'super_admin'
        || /admin|security|delete|backup|restore|payout|payment|role|permission|production/i.test(`${action} ${route} ${category}`);
    const preferredMethod = choosePreferredMethod(allowedMethods, {
        role,
        passkeyAvailable: passkeyPreferred && hasPasskey(user),
    });
    const policy = {
        mfaRequired: freshMfaRequired,
        freshMfaRequired,
        allowedMethods,
        preferredMethod,
        reason: freshMfaRequired ? 'dangerous_action' : 'not_required',
        block: Boolean(freshMfaRequired && allowedMethods.length === 0),
        role,
        action,
        route,
        category,
    };

    return {
        ...policy,
        satisfied: isFreshMfaSatisfied({ user, session, policy, env }),
    };
};

const buildPublicMfaPolicy = (policy = {}) => ({
    mfaRequired: Boolean(policy.mfaRequired),
    freshMfaRequired: Boolean(policy.freshMfaRequired),
    allowedMethods: Array.isArray(policy.allowedMethods) ? policy.allowedMethods : [],
    preferredMethod: policy.preferredMethod || null,
    reason: policy.reason || '',
    block: Boolean(policy.block),
});

module.exports = {
    MFA_METHODS,
    METHOD_STRENGTH,
    buildAllowedMethods,
    buildPublicMfaPolicy,
    evaluateAction,
    evaluateLogin,
    hasPasskey,
    hasRecoveryCodes,
    hasTotp,
    isFreshMfaSatisfied,
    resolveRole,
};

const { resolveMfaConfig } = require('../config/mfaConfig');
const { hasObservedWebAuthnUserVerification } = require('./trustedDeviceAssuranceService');

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

const isAdminSubject = (user = null) => Boolean(
    user?.isAdmin
    || (Array.isArray(user?.adminRoles) && user.adminRoles.some((entry) => normalizeText(entry)))
);

const resolveRole = (user = null) => {
    if (hasAdminRole(user, 'SUPER_ADMIN')) return 'super_admin';
    if (isAdminSubject(user)) return 'admin';
    if (user?.isSeller) return 'seller';
    return 'buyer';
};

const hasPasskey = (user = null) => {
    const adminSubject = isAdminSubject(user);
    const activeMfaCredentialIds = new Set(
        (Array.isArray(user?.mfa?.passkeys) ? user.mfa.passkeys : [])
            .filter((passkey) => !passkey?.revokedAt)
            .map((passkey) => String(passkey?.credentialId || '').trim())
            .filter(Boolean)
    );

    return Boolean(
        Array.isArray(user?.trustedDevices)
        && user.trustedDevices.some((device) => {
            if (device?.revokedAt) return false;
            const expiresAt = device?.expiresAt ? new Date(device.expiresAt).getTime() : 0;
            if (Number.isFinite(expiresAt) && expiresAt > 0 && expiresAt <= Date.now()) return false;
            if (
                normalizeText(device?.method) !== 'webauthn'
                && !String(device?.webauthnCredentialIdBase64Url || '').trim()
            ) {
                return false;
            }
            if (!hasObservedWebAuthnUserVerification(device)) return false;

            const credentialScope = normalizeText(device?.credentialScope);
            if (adminSubject) {
                return credentialScope === 'admin'
                    && normalizeText(device?.adminEligibility) === 'verified';
            }

            const credentialId = String(device?.webauthnCredentialIdBase64Url || '').trim();
            return credentialScope === 'mfa'
                || credentialScope === 'admin'
                || (credentialId && activeMfaCredentialIds.has(credentialId));
        })
    );
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

const isLoginMfaSatisfied = ({ session = null, highRisk = false } = {}) => {
    const amr = Array.isArray(session?.amr)
        ? session.amr.map((entry) => normalizeText(entry))
        : [];
    const completedMfa = amr.includes('mfa') || amr.includes('firebase_mfa');
    if (!completedMfa) return false;
    if (!highRisk) return true;

    const stepUpUntil = session?.stepUpUntil ? new Date(session.stepUpUntil).getTime() : 0;
    return Number.isFinite(stepUpUntil) && stepUpUntil > Date.now();
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
    const policyRequired = Boolean(config.enabled && (userEnabled || adminRequired || sellerRequired || highRisk));
    const satisfied = Boolean(
        policyRequired
        && isLoginMfaSatisfied({ session: context.session, highRisk })
    );
    const mfaRequired = Boolean(policyRequired && !satisfied);
    const allowedMethods = mfaRequired
        ? buildAllowedMethods({ user, config, role, lowRiskBuyer: !highRisk && role === 'buyer' })
        : [];
    const preferredMethod = choosePreferredMethod(allowedMethods, {
        role,
        passkeyAvailable: hasPasskey(user),
    });

    const reason = !policyRequired
        ? 'not_required'
        : satisfied
            ? 'satisfied'
            : highRisk
                ? 'suspicious_login'
                : adminRequired
                    ? 'admin_policy'
                    : sellerRequired
                        ? 'seller_policy'
                        : 'user_enabled';

    return {
        mfaRequired,
        policyRequired,
        satisfied,
        freshMfaRequired: false,
        allowedMethods,
        preferredMethod,
        reason,
        block: Boolean(mfaRequired && allowedMethods.length === 0),
        role,
    };
};

const isFreshMfaSatisfied = ({ session = null, policy = {} } = {}) => {
    if (!policy?.freshMfaRequired) return true;
    const stepUpUntil = session?.stepUpUntil ? new Date(session.stepUpUntil).getTime() : 0;
    const now = Date.now();
    const activeSessionStepUp = Number.isFinite(stepUpUntil) && stepUpUntil > now;
    const sessionAmr = Array.isArray(session?.amr)
        ? session.amr.map((entry) => normalizeText(entry))
        : [];
    if (!activeSessionStepUp) return false;
    const allowedMethods = Array.isArray(policy.allowedMethods) ? policy.allowedMethods : [];
    if (sessionAmr.includes('firebase_mfa')) {
        return allowedMethods.length === 0
            || allowedMethods.some((method) => method !== MFA_METHODS.PASSKEY);
    }
    if (!sessionAmr.includes('mfa')) return false;
    const methodEvidence = {
        [MFA_METHODS.PASSKEY]: sessionAmr.includes('webauthn') || sessionAmr.includes('passkey'),
        [MFA_METHODS.TOTP]: sessionAmr.includes('totp'),
        [MFA_METHODS.RECOVERY_CODE]: sessionAmr.includes('recovery_code'),
        [MFA_METHODS.EMAIL_OTP]: sessionAmr.includes('email_otp'),
    };
    return allowedMethods.length === 0
        ? Object.values(methodEvidence).some(Boolean)
        : allowedMethods.some((method) => methodEvidence[method] === true);
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
    isAdminSubject,
    isLoginMfaSatisfied,
    resolveRole,
};

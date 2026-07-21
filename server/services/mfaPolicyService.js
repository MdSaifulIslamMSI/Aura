const crypto = require('crypto');
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
const DESKTOP_HANDOFF_MFA_PREFIX = 'desktop_handoff_mfa:';
const DESKTOP_HANDOFF_ADMIN_MFA_PREFIX = 'desktop_handoff_admin_mfa:';

const buildDesktopHandoffMfaMarker = (deviceId = '', { admin = false } = {}) => {
    const normalizedDeviceId = String(deviceId || '').trim();
    if (!normalizedDeviceId) return '';
    const deviceBinding = crypto
        .createHash('sha256')
        .update(normalizedDeviceId, 'utf8')
        .digest('hex')
        .slice(0, 32);
    return `${admin ? DESKTOP_HANDOFF_ADMIN_MFA_PREFIX : DESKTOP_HANDOFF_MFA_PREFIX}${deviceBinding}`;
};

const resolveDesktopHandoffMfaBinding = (session = null, amr = []) => {
    const normalizedAmr = Array.isArray(amr) ? amr : [];
    const genericMarker = buildDesktopHandoffMfaMarker(session?.deviceId);
    const adminMarker = buildDesktopHandoffMfaMarker(session?.deviceId, { admin: true });
    const hasTargetDeviceProof = Boolean(
        normalizeText(session?.deviceMethod) === 'browser_key'
        && normalizedAmr.includes('desktop_handoff')
        && normalizedAmr.includes('device_binding')
    );
    return {
        markerPresent: normalizedAmr.some((entry) => (
            entry.startsWith(DESKTOP_HANDOFF_MFA_PREFIX)
            || entry.startsWith(DESKTOP_HANDOFF_ADMIN_MFA_PREFIX)
        )),
        genericBound: Boolean(
            hasTargetDeviceProof
            && genericMarker
            && normalizedAmr.includes(genericMarker)
        ),
        adminBound: Boolean(
            hasTargetDeviceProof
            && adminMarker
            && normalizedAmr.includes(adminMarker)
        ),
    };
};

const isDesktopHandoffAdminMfaSatisfied = (session = null) => {
    const amr = Array.isArray(session?.amr)
        ? session.amr.map((entry) => normalizeText(entry)).filter(Boolean)
        : [];
    const binding = resolveDesktopHandoffMfaBinding(session, amr);
    return Boolean(amr.includes('mfa') && binding.adminBound);
};

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

const isActiveTrustedDevice = (device = null) => {
    if (!device || device?.revokedAt) return false;
    const expiresAt = device?.expiresAt ? new Date(device.expiresAt).getTime() : 0;
    return !(Number.isFinite(expiresAt) && expiresAt > 0 && expiresAt <= Date.now());
};

const isWebAuthnTrustedDevice = (device = null) => Boolean(
    normalizeText(device?.method) === 'webauthn'
    || String(device?.webauthnCredentialIdBase64Url || '').trim()
);

const getCurrentTrustedDevice = (user = null, session = null) => {
    const currentDeviceId = String(session?.deviceId || '').trim();
    if (!currentDeviceId || !Array.isArray(user?.trustedDevices)) return null;
    return user.trustedDevices.find((device) => (
        String(device?.deviceId || '').trim() === currentDeviceId
    )) || null;
};

const isVerifiedAdminPasskeyDevice = (device = null) => Boolean(
    isActiveTrustedDevice(device)
    && isWebAuthnTrustedDevice(device)
    && hasObservedWebAuthnUserVerification(device)
    && normalizeText(device?.credentialScope) === 'admin'
    && normalizeText(device?.adminEligibility) === 'verified'
);

const isCurrentLegacyAdminPasskeyCandidate = ({ user = null, session = null } = {}) => {
    if (!isAdminSubject(user)) return false;
    const device = getCurrentTrustedDevice(user, session);
    return Boolean(
        isActiveTrustedDevice(device)
        && isWebAuthnTrustedDevice(device)
        && normalizeText(device?.credentialScope) === 'recognition'
        && normalizeText(device?.adminEligibility) === 'legacy_candidate'
        && normalizeText(device?.enrollmentContext) === 'legacy_admin_snapshot'
    );
};

const isEligiblePasskeyMfaDevice = ({ user = null, device = null } = {}) => {
    if (!isActiveTrustedDevice(device) || !isWebAuthnTrustedDevice(device)) return false;
    if (!hasObservedWebAuthnUserVerification(device)) return false;
    if (isAdminSubject(user)) return isVerifiedAdminPasskeyDevice(device);

    const activeMfaCredentialIds = new Set(
        (Array.isArray(user?.mfa?.passkeys) ? user.mfa.passkeys : [])
            .filter((passkey) => !passkey?.revokedAt)
            .map((passkey) => String(passkey?.credentialId || '').trim())
            .filter(Boolean)
    );
    const credentialScope = normalizeText(device?.credentialScope);
    const credentialId = String(device?.webauthnCredentialIdBase64Url || '').trim();
    return credentialScope === 'mfa'
        || credentialScope === 'admin'
        || (credentialId && activeMfaCredentialIds.has(credentialId));
};

const hasPasskey = (user = null) => {
    return Boolean(
        Array.isArray(user?.trustedDevices)
        && user.trustedDevices.some((device) => isEligiblePasskeyMfaDevice({ user, device }))
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

const isLoginMfaSatisfied = ({ user = null, session = null, highRisk = false } = {}) => {
    const amr = Array.isArray(session?.amr)
        ? session.amr.map((entry) => normalizeText(entry))
        : [];
    const handoffBinding = resolveDesktopHandoffMfaBinding(session, amr);
    const independentMethodEvidence = [
        'firebase_mfa',
        'totp',
        'duo',
        'duo_oidc',
        'recovery_code',
        'email_otp',
        'webauthn',
        'passkey',
    ].some((method) => amr.includes(method));
    const derivedHandoffMfaValid = handoffBinding.genericBound || handoffBinding.adminBound;
    const completedMfa = amr.includes('firebase_mfa') || Boolean(
        amr.includes('mfa')
        && (
            !handoffBinding.markerPresent
            || derivedHandoffMfaValid
            || independentMethodEvidence
        )
    );
    if (!completedMfa) return false;
    if (isAdminSubject(user)) {
        const independentAdminFactor = [
            'firebase_mfa',
            'totp',
            'duo',
            'duo_oidc',
            'recovery_code',
        ].some((method) => amr.includes(method));
        if (handoffBinding.adminBound) {
            if (!highRisk) return true;
            const stepUpUntil = session?.stepUpUntil ? new Date(session.stepUpUntil).getTime() : 0;
            return Number.isFinite(stepUpUntil) && stepUpUntil > Date.now();
        }
        const passkeyClaimed = amr.includes('webauthn') || amr.includes('passkey');
        if (!independentAdminFactor) {
            const currentDevice = getCurrentTrustedDevice(user, session);
            if (!passkeyClaimed || !isVerifiedAdminPasskeyDevice(currentDevice)) return false;
        }
    }
    if (!highRisk) return true;

    const stepUpUntil = session?.stepUpUntil ? new Date(session.stepUpUntil).getTime() : 0;
    return Number.isFinite(stepUpUntil) && stepUpUntil > Date.now();
};

const buildAllowedMethods = ({
    user = null,
    config = resolveMfaConfig(),
    role = resolveRole(user),
    lowRiskBuyer = false,
    session = null,
    allowLegacyAdminRecovery = false,
} = {}) => {
    const methods = [];
    const passkeyAvailable = hasPasskey(user)
        || (
            allowLegacyAdminRecovery
            && isCurrentLegacyAdminPasskeyCandidate({ user, session })
        );
    if (config.passkeyEnabled && passkeyAvailable) methods.push(MFA_METHODS.PASSKEY);
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
        && isLoginMfaSatisfied({ user, session: context.session, highRisk })
    );
    const mfaRequired = Boolean(policyRequired && !satisfied);
    const allowedMethods = mfaRequired
        ? buildAllowedMethods({
            user,
            config,
            role,
            lowRiskBuyer: !highRisk && role === 'buyer',
            session: context.session,
            allowLegacyAdminRecovery: true,
        })
        : [];
    const preferredMethod = choosePreferredMethod(allowedMethods, {
        role,
        passkeyAvailable: hasPasskey(user)
            || isCurrentLegacyAdminPasskeyCandidate({ user, session: context.session }),
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
    buildDesktopHandoffMfaMarker,
    buildAllowedMethods,
    buildPublicMfaPolicy,
    evaluateAction,
    evaluateLogin,
    hasPasskey,
    hasRecoveryCodes,
    hasTotp,
    isCurrentLegacyAdminPasskeyCandidate,
    isDesktopHandoffAdminMfaSatisfied,
    isEligiblePasskeyMfaDevice,
    isFreshMfaSatisfied,
    isAdminSubject,
    isLoginMfaSatisfied,
    isVerifiedAdminPasskeyDevice,
    resolveRole,
};

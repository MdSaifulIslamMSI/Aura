const crypto = require('crypto');
const User = require('../models/User');
const { resolveMfaConfig } = require('../config/mfaConfig');
const AppError = require('../utils/AppError');
const { revokeBrowserSessionsForDevices } = require('./browserSessionService');
const { normalizeDeviceId } = require('./trustedDeviceChallengeService');
const { hasObservedWebAuthnUserVerification } = require('./trustedDeviceAssuranceService');
const { mirrorTrustedDeviceMetadata } = require('./trustedDeviceV2RuntimeService');
const { isAdminSubject } = require('./mfaPolicyService');

const MFA_PROFILE_PROJECTION = 'name email phone avatar gender dob bio isAdmin adminRoles isVerified isSeller sellerActivatedAt accountState moderation authAssurance authAssuranceAt trustedDevices recoveryCodeState mfa loyalty createdAt';

const normalizeText = (value) => String(value || '').trim();
const normalizeMethod = (value) => normalizeText(value).toLowerCase();
const normalizeDeviceLabel = (value) => normalizeText(value)
    .replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, '')
    .replace(/\s+/g, ' ')
    .slice(0, 120);

const parseBoolean = (value, fallback = false) => {
    if (value === undefined || value === null || value === '') return fallback;
    if (typeof value === 'boolean') return value;
    const normalized = normalizeMethod(value);
    if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
    if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
    return fallback;
};

const createOperationalError = (message, statusCode, code) => {
    const error = new AppError(message, statusCode);
    error.code = code;
    return error;
};

const isActiveTrustedDevice = (device = null, now = Date.now()) => {
    if (!device || device.revokedAt) return false;
    const expiresAt = device.expiresAt ? new Date(device.expiresAt).getTime() : 0;
    return !Number.isFinite(expiresAt) || expiresAt <= 0 || expiresAt > now;
};

const isPasskeyDevice = (device = null) => Boolean(
    device
    && (
        normalizeMethod(device.method) === 'webauthn'
        || normalizeText(device.webauthnCredentialIdBase64Url)
    )
);

const isAdminQualifiedPasskey = (device = null) => {
    if (!isPasskeyDevice(device)) return false;
    return normalizeMethod(device.adminEligibility) === 'verified'
        && normalizeMethod(device.credentialScope) === 'admin'
        && hasObservedWebAuthnUserVerification(device);
};

const getActiveMfaPasskeys = (trustedDevices = [], mfaPasskeys = []) => {
    const activeMfaCredentialIds = new Set(
        mfaPasskeys
            .filter((passkey) => !passkey?.revokedAt)
            .map((passkey) => normalizeText(passkey?.credentialId))
            .filter(Boolean)
    );

    return trustedDevices.filter((device) => {
        if (!isActiveTrustedDevice(device) || !isPasskeyDevice(device)) return false;
        if (!hasObservedWebAuthnUserVerification(device)) return false;
        const scope = normalizeMethod(device.credentialScope);
        const credentialId = normalizeText(device.webauthnCredentialIdBase64Url);
        return scope === 'mfa'
            || scope === 'admin'
            || (credentialId && activeMfaCredentialIds.has(credentialId));
    });
};

const hasEnabledTotp = (user = null) => Boolean(
    user?.mfa?.totp?.enabled
    && user?.mfa?.totp?.confirmedAt
);

const resolveNextMfaState = ({ user, trustedDevices, mfaPasskeys }) => {
    const activeMfaPasskeys = getActiveMfaPasskeys(trustedDevices, mfaPasskeys);
    const totpEnabled = hasEnabledTotp(user);
    const enabled = activeMfaPasskeys.length > 0 || totpEnabled;
    const currentDefault = normalizeMethod(user?.mfa?.defaultMethod);
    const passkeyAvailable = activeMfaPasskeys.length > 0;

    let defaultMethod = '';
    if (currentDefault === 'passkey' && passkeyAvailable) defaultMethod = 'passkey';
    else if (currentDefault === 'totp' && totpEnabled) defaultMethod = 'totp';
    else if (passkeyAvailable) defaultMethod = 'passkey';
    else if (totpEnabled) defaultMethod = 'totp';

    return {
        activeMfaPasskeys,
        defaultMethod,
        enabled,
        totpEnabled,
    };
};

const assertRevocationPreservesRequiredFactors = ({
    user,
    currentTrustedDevices,
    nextTrustedDevices,
    currentMfaPasskeys,
    nextMfaPasskeys,
    env = process.env,
}) => {
    const currentState = resolveNextMfaState({
        user,
        trustedDevices: currentTrustedDevices,
        mfaPasskeys: currentMfaPasskeys,
    });
    const nextState = resolveNextMfaState({
        user,
        trustedDevices: nextTrustedDevices,
        mfaPasskeys: nextMfaPasskeys,
    });
    const config = resolveMfaConfig(env);
    const production = normalizeMethod(env.NODE_ENV) === 'production';
    const adminSubject = isAdminSubject(user);
    const adminPasskeyRequired = Boolean(
        adminSubject
        && parseBoolean(env.ADMIN_REQUIRE_PASSKEY, production)
    );
    const currentAdminPasskeys = currentTrustedDevices.filter((device) => (
        isActiveTrustedDevice(device) && isAdminQualifiedPasskey(device)
    ));
    const nextAdminPasskeys = nextTrustedDevices.filter((device) => (
        isActiveTrustedDevice(device) && isAdminQualifiedPasskey(device)
    ));

    if (
        adminPasskeyRequired
        && currentAdminPasskeys.length > 0
        && nextAdminPasskeys.length === 0
    ) {
        throw createOperationalError(
            'At least one admin passkey must remain registered.',
            409,
            'ADMIN_PASSKEY_REQUIRED'
        );
    }

    const policyRequiresMfa = Boolean(
        user?.mfa?.requiredByPolicy
        || (adminSubject && config.requiredForAdmins)
        || (user?.isSeller && config.requiredForSellers)
    );
    if (policyRequiresMfa && currentState.enabled && !nextState.enabled) {
        throw createOperationalError(
            'Add another MFA method before revoking the last factor.',
            409,
            'LAST_MFA_FACTOR_REQUIRED'
        );
    }

    return nextState;
};

const loadUserForDeviceManagement = async (userId) => {
    const normalizedUserId = normalizeText(userId);
    if (!normalizedUserId) {
        throw createOperationalError('Authenticated user is required.', 401, 'AUTH_REQUIRED');
    }
    const user = await User.findById(normalizedUserId)
        .select('+mfa.passkeys.credentialId')
        .lean();
    if (!user) {
        throw createOperationalError('User not found.', 404, 'USER_NOT_FOUND');
    }
    return user;
};

const persistManagedUser = async ({
    userId,
    expectedVersion,
    trustedDevices,
    mfaPasskeys,
    mfaState,
}) => {
    const updated = await User.findOneAndUpdate(
        { _id: userId, __v: Number(expectedVersion || 0) },
        {
            $set: {
                trustedDevices,
                'mfa.passkeys': mfaPasskeys,
                'mfa.enabled': mfaState.enabled,
                'mfa.defaultMethod': mfaState.defaultMethod,
            },
            $inc: { __v: 1 },
        },
        {
            returnDocument: 'after',
            projection: MFA_PROFILE_PROJECTION,
            lean: true,
        }
    );
    if (!updated) {
        throw createOperationalError(
            'Trusted device state changed. Refresh and try again.',
            409,
            'TRUSTED_DEVICE_STATE_CHANGED'
        );
    }
    return updated;
};

const renameTrustedDevice = async ({ userId, deviceId, label }) => {
    const normalizedDeviceId = normalizeDeviceId(deviceId);
    const normalizedLabel = normalizeDeviceLabel(label);
    if (!normalizedDeviceId) {
        throw createOperationalError('Valid trusted device ID is required.', 400, 'TRUSTED_DEVICE_ID_INVALID');
    }
    if (!normalizedLabel) {
        throw createOperationalError('Trusted device label is required.', 400, 'TRUSTED_DEVICE_LABEL_REQUIRED');
    }

    const user = await loadUserForDeviceManagement(userId);
    const trustedDevices = Array.isArray(user.trustedDevices) ? user.trustedDevices : [];
    const target = trustedDevices.find((device) => (
        normalizeDeviceId(device?.deviceId) === normalizedDeviceId
        && isActiveTrustedDevice(device)
    ));
    if (!target) {
        throw createOperationalError('Trusted device not found.', 404, 'TRUSTED_DEVICE_NOT_FOUND');
    }

    const credentialId = normalizeText(target.webauthnCredentialIdBase64Url);
    const nextTrustedDevices = trustedDevices.map((device) => (
        normalizeDeviceId(device?.deviceId) === normalizedDeviceId
            ? { ...device, label: normalizedLabel }
            : device
    ));
    const currentMfaPasskeys = Array.isArray(user?.mfa?.passkeys) ? user.mfa.passkeys : [];
    const nextMfaPasskeys = currentMfaPasskeys.map((passkey) => (
        credentialId && normalizeText(passkey?.credentialId) === credentialId
            ? { ...passkey, name: normalizedLabel }
            : passkey
    ));
    const currentDefaultMethod = normalizeMethod(user?.mfa?.defaultMethod);
    const mfaState = {
        enabled: Boolean(user?.mfa?.enabled),
        defaultMethod: ['passkey', 'totp'].includes(currentDefaultMethod) ? currentDefaultMethod : '',
    };
    const updated = await persistManagedUser({
        userId: user._id,
        expectedVersion: user.__v,
        trustedDevices: nextTrustedDevices,
        mfaPasskeys: nextMfaPasskeys,
        mfaState,
    });
    await mirrorTrustedDeviceMetadata({
        user: updated,
        devices: nextTrustedDevices.filter((device) => (
            normalizeDeviceId(device?.deviceId) === normalizedDeviceId
        )),
        revocationReasonCode: 'metadata_update',
    });

    return {
        deviceId: normalizedDeviceId,
        label: normalizedLabel,
        user: updated,
    };
};

const revokeTrustedDevices = async ({
    userId,
    deviceId = '',
    credentialId = '',
    currentDeviceId = '',
    revokeAllOthers = false,
    env = process.env,
}) => {
    const normalizedDeviceId = deviceId ? normalizeDeviceId(deviceId) : '';
    const normalizedCredentialId = normalizeText(credentialId);
    const normalizedCurrentDeviceId = currentDeviceId ? normalizeDeviceId(currentDeviceId) : '';
    if (deviceId && !normalizedDeviceId) {
        throw createOperationalError('Valid trusted device ID is required.', 400, 'TRUSTED_DEVICE_ID_INVALID');
    }
    if (revokeAllOthers && !normalizedCurrentDeviceId) {
        throw createOperationalError(
            'Current browser session is not bound to a trusted device.',
            400,
            'CURRENT_TRUSTED_DEVICE_REQUIRED'
        );
    }
    if (!revokeAllOthers && !normalizedDeviceId && !normalizedCredentialId) {
        throw createOperationalError(
            'Trusted device ID or credential ID is required.',
            400,
            'TRUSTED_DEVICE_SELECTOR_REQUIRED'
        );
    }

    const user = await loadUserForDeviceManagement(userId);
    const currentTrustedDevices = Array.isArray(user.trustedDevices) ? user.trustedDevices : [];
    const currentMfaPasskeys = Array.isArray(user?.mfa?.passkeys) ? user.mfa.passkeys : [];
    const targets = currentTrustedDevices.filter((device) => {
        if (!isActiveTrustedDevice(device)) return false;
        const candidateDeviceId = normalizeDeviceId(device?.deviceId);
        if (revokeAllOthers) return candidateDeviceId !== normalizedCurrentDeviceId;
        const candidateCredentialId = normalizeText(device?.webauthnCredentialIdBase64Url);
        if (normalizedDeviceId && normalizedCredentialId) {
            return candidateDeviceId === normalizedDeviceId
                && candidateCredentialId === normalizedCredentialId;
        }
        if (normalizedDeviceId) return candidateDeviceId === normalizedDeviceId;
        return candidateCredentialId === normalizedCredentialId;
    });

    if (!revokeAllOthers && targets.length === 0) {
        throw createOperationalError('Trusted device not found.', 404, 'TRUSTED_DEVICE_NOT_FOUND');
    }
    if (targets.length === 0) {
        return {
            revokedDeviceIds: [],
            revokedSessions: 0,
            user,
        };
    }

    const now = new Date();
    const targetDeviceIds = new Set(targets.map((device) => normalizeDeviceId(device.deviceId)));
    const targetCredentialIds = new Set(
        targets
            .map((device) => normalizeText(device.webauthnCredentialIdBase64Url))
            .filter(Boolean)
    );
    const nextTrustedDevices = currentTrustedDevices.map((device) => (
        targetDeviceIds.has(normalizeDeviceId(device?.deviceId))
            ? {
                ...device,
                revokedAt: now,
                sessionVersion: crypto.randomBytes(16).toString('hex'),
            }
            : device
    ));
    const nextMfaPasskeys = currentMfaPasskeys.map((passkey) => (
        targetCredentialIds.has(normalizeText(passkey?.credentialId))
            ? { ...passkey, revokedAt: now }
            : passkey
    ));
    const nextMfaState = assertRevocationPreservesRequiredFactors({
        user,
        currentTrustedDevices,
        nextTrustedDevices,
        currentMfaPasskeys,
        nextMfaPasskeys,
        env,
    });
    const updated = await persistManagedUser({
        userId: user._id,
        expectedVersion: user.__v,
        trustedDevices: nextTrustedDevices,
        mfaPasskeys: nextMfaPasskeys,
        mfaState: nextMfaState,
    });
    await mirrorTrustedDeviceMetadata({
        user: updated,
        devices: nextTrustedDevices.filter((device) => (
            targetDeviceIds.has(normalizeDeviceId(device?.deviceId))
        )),
        revocationReasonCode: revokeAllOthers ? 'user_revoked_others' : 'user_revoked',
    });
    const sessionRevocation = await revokeBrowserSessionsForDevices(user._id, [...targetDeviceIds]);

    return {
        revokedDeviceIds: [...targetDeviceIds],
        revokedSessions: Number(sessionRevocation?.revoked || 0),
        user: updated,
    };
};

module.exports = {
    isActiveTrustedDevice,
    isPasskeyDevice,
    renameTrustedDevice,
    revokeTrustedDevices,
};

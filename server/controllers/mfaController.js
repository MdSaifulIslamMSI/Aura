const asyncHandler = require('express-async-handler');
const User = require('../models/User');
const AppError = require('../utils/AppError');
const { buildSessionPayload } = require('../services/authSessionService');
const {
    SESSION_STEP_UP_TTL_MS,
    refreshBrowserSession,
} = require('../services/browserSessionService');
const {
    extractTrustedDeviceContext,
    getTrustedDeviceRegistration,
    issueTrustedDeviceChallenge,
    verifyTrustedDeviceChallenge,
} = require('../services/trustedDeviceChallengeService');
const {
    beginTotpSetup,
    disableTotpAfterFreshMfa,
    enableTotpAfterVerification,
    getPendingTotpSetup,
    verifyEnabledTotpForUser,
} = require('../services/totpMfaService');
const {
    consumeMfaChallenge,
    createMfaChallenge,
    inspectMfaChallenge,
} = require('../services/mfaChallengeService');
const {
    MFA_METHODS,
    buildPublicMfaPolicy,
    evaluateAction,
    evaluateLogin,
    hasPasskey,
    hasTotp,
} = require('../services/mfaPolicyService');
const {
    generateRecoveryCodes,
    verifyAndConsumeRecoveryCode,
} = require('../services/recoveryCodeService');
const { resolveMfaConfig } = require('../config/mfaConfig');
const { recordAuthSecurityEvent } = require('../services/authSecurityTelemetryService');
const { invalidateUserCache, invalidateUserCacheByEmail } = require('../middleware/authMiddleware');

const MFA_PROFILE_PROJECTION = 'name email phone avatar gender dob bio isAdmin adminRoles isVerified isSeller sellerActivatedAt accountState moderation authAssurance authAssuranceAt trustedDevices recoveryCodeState mfa loyalty createdAt';

const normalizeText = (value) => String(value || '').trim();
const normalizeMethod = (value) => normalizeText(value).toLowerCase();

const getStepUpExpiry = () => new Date(Date.now() + SESSION_STEP_UP_TTL_MS).toISOString();

const getFreshUser = async (userId) => User.findById(userId, MFA_PROFILE_PROJECTION).lean();

const buildMfaState = (user = null) => {
    const trustedDevices = Array.isArray(user?.trustedDevices) ? user.trustedDevices : [];
    const passkeys = trustedDevices.filter((device) => (
        normalizeMethod(device?.method) === 'webauthn'
        || Boolean(normalizeText(device?.webauthnCredentialIdBase64Url))
    ));

    return {
        enabled: Boolean(user?.mfa?.enabled),
        defaultMethod: normalizeText(user?.mfa?.defaultMethod),
        requiredByPolicy: Boolean(user?.mfa?.requiredByPolicy),
        lastMfaAt: user?.mfa?.lastMfaAt || null,
        lastMfaMethod: normalizeText(user?.mfa?.lastMfaMethod),
        methods: {
            passkey: {
                enabled: passkeys.length > 0,
                count: passkeys.length,
                devices: passkeys.map((device) => ({
                    deviceId: normalizeText(device.deviceId),
                    label: normalizeText(device.label),
                    createdAt: device.createdAt || null,
                    lastUsedAt: device.lastVerifiedAt || device.lastSeenAt || null,
                    transports: Array.isArray(device.webauthnTransports) ? device.webauthnTransports : [],
                })),
            },
            totp: {
                enabled: Boolean(user?.mfa?.totp?.enabled),
                confirmedAt: user?.mfa?.totp?.confirmedAt || null,
                lastVerifiedAt: user?.mfa?.totp?.lastVerifiedAt || null,
                pending: Boolean(user?.mfa?.totp?.pendingCreatedAt),
            },
            recoveryCodes: {
                enabled: Number(user?.recoveryCodeState?.activeCount || 0) > 0,
                activeCount: Math.max(Number(user?.recoveryCodeState?.activeCount || 0), 0),
                generatedAt: user?.recoveryCodeState?.generatedAt || null,
                lastUsedAt: user?.recoveryCodeState?.lastUsedAt || null,
            },
        },
        trustedDevices: trustedDevices.map((device) => ({
            deviceId: normalizeText(device.deviceId),
            label: normalizeText(device.label),
            method: normalizeMethod(device.method) || (device.webauthnCredentialIdBase64Url ? 'webauthn' : 'browser_key'),
            createdAt: device.createdAt || null,
            lastSeenAt: device.lastSeenAt || null,
            lastVerifiedAt: device.lastVerifiedAt || null,
            expiresAt: device.expiresAt || null,
            revokedAt: device.revokedAt || null,
        })),
    };
};

const persistMfaSession = async ({
    req,
    res,
    user,
    method,
    riskState = '',
} = {}) => {
    const normalizedMethod = normalizeMethod(method);
    const additionalAmr = normalizedMethod === MFA_METHODS.PASSKEY
        ? ['webauthn', 'passkey', 'mfa']
        : [normalizedMethod, 'mfa'].filter(Boolean);
    const authSession = await refreshBrowserSession({
        req,
        res,
        currentSession: req.authSession || null,
        user,
        authUid: req.authUid || req.authToken?.uid || '',
        authToken: req.authToken || null,
        rotate: Boolean(req.authSession?.sessionId),
        deviceMethod: normalizedMethod === MFA_METHODS.PASSKEY ? 'webauthn' : '',
        stepUpUntil: getStepUpExpiry(),
        additionalAmr,
        riskState,
    });
    req.authSession = authSession;
    return authSession;
};

const respondWithAuthenticatedSession = ({ req, res, user, method, message = 'MFA verification successful.' } = {}) => {
    recordAuthSecurityEvent({
        event: 'mfa.challenge.consumed',
        outcome: 'success',
        reason: 'none',
        surface: 'mfa',
        req,
        meta: { method },
    });

    return res.json({
        success: true,
        message,
        ...buildSessionPayload({
            authUser: {
                uid: req.authUid || req.authToken?.uid || '',
                email: req.authToken?.email || user?.email || '',
                emailVerified: Boolean(req.authToken?.email_verified ?? user?.isVerified),
                name: req.authToken?.name || user?.name || '',
            },
            authToken: req.authToken || null,
            authUid: req.authUid || req.authToken?.uid || '',
            authSession: req.authSession || null,
            user,
            status: 'authenticated',
            deviceChallenge: null,
        }),
        mfa: buildMfaState(user),
    });
};

const assertMfaFeature = ({ method = '' } = {}) => {
    const config = resolveMfaConfig();
    if (!config.enabled) throw new AppError('MFA is disabled.', 403);
    if (method === MFA_METHODS.TOTP && !config.totpEnabled) {
        throw new AppError('Authenticator app MFA is disabled.', 403);
    }
    if (method === MFA_METHODS.PASSKEY && !config.passkeyEnabled) {
        throw new AppError('Passkey MFA is disabled.', 403);
    }
    if (method === MFA_METHODS.RECOVERY_CODE && !config.recoveryCodesEnabled) {
        throw new AppError('Recovery-code MFA is disabled.', 403);
    }
};

const getMfaSecurityCenter = asyncHandler(async (req, res) => {
    const user = await getFreshUser(req.user?._id);
    if (!user?._id) throw new AppError('User not found.', 404);
    const loginPolicy = evaluateLogin({ user });

    res.json({
        success: true,
        flags: {
            enabled: resolveMfaConfig().enabled,
            totpEnabled: resolveMfaConfig().totpEnabled,
            passkeyEnabled: resolveMfaConfig().passkeyEnabled,
            recoveryCodesEnabled: resolveMfaConfig().recoveryCodesEnabled,
        },
        mfa: buildMfaState(user),
        policy: buildPublicMfaPolicy(loginPolicy),
    });
});

const setupTotp = asyncHandler(async (req, res) => {
    assertMfaFeature({ method: MFA_METHODS.TOTP });
    const setup = await beginTotpSetup({ userId: req.user?._id });
    recordAuthSecurityEvent({
        event: 'mfa.totp.setup.started',
        outcome: 'success',
        reason: 'none',
        surface: 'mfa',
        req,
    });
    res.status(201).json({ success: true, ...setup });
});

const getTotpQr = asyncHandler(async (req, res) => {
    assertMfaFeature({ method: MFA_METHODS.TOTP });
    const setup = await getPendingTotpSetup({ userId: req.user?._id });
    res.json({ success: true, ...setup });
});

const verifyTotpSetup = asyncHandler(async (req, res) => {
    assertMfaFeature({ method: MFA_METHODS.TOTP });
    const result = await enableTotpAfterVerification({
        userId: req.user?._id,
        code: req.body?.code,
    });
    await invalidateUserCache(req.authUid || '');
    await invalidateUserCacheByEmail(req.user?.email || '');

    recordAuthSecurityEvent({
        event: 'mfa.totp.enabled',
        outcome: 'success',
        reason: 'none',
        surface: 'mfa',
        req,
    });

    res.json({
        success: true,
        message: 'Authenticator app MFA enabled.',
        recoveryCodes: result.recoveryCodes,
        recoveryCodeState: result.recoveryCodeState,
        recoveryReadiness: result.recoveryReadiness,
        mfa: buildMfaState(result.user),
    });
});

const verifyTotpLogin = asyncHandler(async (req, res) => {
    assertMfaFeature({ method: MFA_METHODS.TOTP });
    const challengeId = normalizeText(req.body?.challengeId || req.body?.challengeToken);
    const inspected = await inspectMfaChallenge({
        challengeId,
        userId: req.user?._id,
        method: MFA_METHODS.TOTP,
        purpose: normalizeText(req.body?.purpose) || 'login',
        action: normalizeText(req.body?.action),
    });
    if (!inspected.success) {
        throw new AppError('MFA challenge is invalid or expired.', 401);
    }

    let user;
    try {
        user = await verifyEnabledTotpForUser({
            userId: req.user?._id,
            code: req.body?.code,
        });
    } catch (error) {
        recordAuthSecurityEvent({
            event: 'mfa.totp.failed',
            outcome: 'failure',
            reason: 'invalid',
            surface: 'mfa',
            req,
            meta: { statusCode: error?.statusCode || 401 },
        });
        throw error;
    }

    const consumed = await consumeMfaChallenge({
        challengeId,
        userId: req.user?._id,
        method: MFA_METHODS.TOTP,
        purpose: normalizeText(req.body?.purpose) || 'login',
        action: normalizeText(req.body?.action),
    });
    if (!consumed.success) throw new AppError('MFA challenge is invalid or expired.', 401);

    await persistMfaSession({ req, res, user, method: MFA_METHODS.TOTP });
    await invalidateUserCache(req.authUid || '');
    await invalidateUserCacheByEmail(user?.email || '');
    return respondWithAuthenticatedSession({
        req,
        res,
        user,
        method: MFA_METHODS.TOTP,
        message: 'Authenticator app MFA verified.',
    });
});

const disableTotp = asyncHandler(async (req, res) => {
    assertMfaFeature({ method: MFA_METHODS.TOTP });
    const user = await disableTotpAfterFreshMfa({ userId: req.user?._id });
    await invalidateUserCache(req.authUid || '');
    await invalidateUserCacheByEmail(req.user?.email || '');
    recordAuthSecurityEvent({
        event: 'mfa.totp.disabled',
        outcome: 'success',
        reason: 'none',
        surface: 'mfa',
        req,
    });
    res.json({ success: true, mfa: buildMfaState(user) });
});

const passkeyRegisterOptions = asyncHandler(async (req, res) => {
    assertMfaFeature({ method: MFA_METHODS.PASSKEY });
    const { deviceId, deviceLabel } = extractTrustedDeviceContext(req);
    if (!deviceId) throw new AppError('Trusted device identity is missing.', 400);
    const challenge = await issueTrustedDeviceChallenge({
        user: req.user,
        authUid: req.authUid || '',
        authToken: req.authToken || null,
        deviceId,
        deviceLabel,
        req,
        allowEnrollment: true,
        challengeScope: 'mfa-passkey-register',
    });
    res.status(201).json({ success: true, deviceChallenge: challenge });
});

const syncPasskeyMfaState = async ({ userId, trustedDevice }) => {
    const credentialId = normalizeText(trustedDevice?.webauthnCredentialIdBase64Url);
    if (!credentialId) return getFreshUser(userId);
    const user = await User.findById(userId)
        .select('+mfa.passkeys.credentialId')
        .lean();
    const now = new Date();
    const passkeyRecord = {
        credentialId,
        publicKey: '',
        counter: Number(trustedDevice?.webauthnCounter || 0),
        transports: Array.isArray(trustedDevice?.webauthnTransports) ? trustedDevice.webauthnTransports : [],
        deviceType: normalizeText(trustedDevice?.authenticatorAttachment),
        backedUp: false,
        name: normalizeText(trustedDevice?.label) || 'Passkey',
        createdAt: trustedDevice?.createdAt || now,
        lastUsedAt: now,
    };
    const existingPasskeys = Array.isArray(user?.mfa?.passkeys) ? user.mfa.passkeys : [];
    const hasExisting = existingPasskeys.some((passkey) => normalizeText(passkey.credentialId) === credentialId);
    const nextPasskeys = hasExisting
        ? existingPasskeys.map((passkey) => (
            normalizeText(passkey.credentialId) === credentialId
                ? {
                    ...passkey,
                    ...passkeyRecord,
                    createdAt: passkey.createdAt || passkeyRecord.createdAt,
                }
                : passkey
        ))
        : [...existingPasskeys, passkeyRecord];

    return User.findByIdAndUpdate(
        userId,
        {
            $set: {
                'mfa.enabled': true,
                'mfa.defaultMethod': 'passkey',
                'mfa.lastMfaAt': now,
                'mfa.lastMfaMethod': 'passkey',
                'mfa.passkeys': nextPasskeys,
            },
        },
        {
            returnDocument: 'after',
            projection: MFA_PROFILE_PROJECTION,
            lean: true,
        }
    );
};

const verifyPasskeyChallenge = async ({ req, expectedScope = '' } = {}) => {
    const { deviceId, deviceLabel } = extractTrustedDeviceContext(req);
    if (!deviceId) throw new AppError('Trusted device identity is missing.', 400);

    const verification = await verifyTrustedDeviceChallenge({
        user: req.user,
        authUid: req.authUid || '',
        authToken: req.authToken || null,
        token: req.body?.token || req.body?.challengeToken,
        method: req.body?.method || 'webauthn',
        proof: req.body?.proof,
        publicKeySpkiBase64: req.body?.publicKeySpkiBase64,
        credential: req.body?.credential,
        deviceId,
        deviceLabel,
        expectedScope,
    });

    if (!verification.success) {
        recordAuthSecurityEvent({
            event: 'mfa.passkey.failed',
            outcome: 'failure',
            reason: verification.reason || 'invalid',
            surface: 'mfa',
            req,
        });
        throw new AppError(`Passkey verification failed: ${verification.reason}`, 403);
    }
    if (verification.method !== 'webauthn') {
        throw new AppError('Passkey verification is required.', 403);
    }
    return verification;
};

const passkeyRegisterVerify = asyncHandler(async (req, res) => {
    assertMfaFeature({ method: MFA_METHODS.PASSKEY });
    const verification = await verifyPasskeyChallenge({ req, expectedScope: 'mfa-passkey-register' });
    const user = await syncPasskeyMfaState({
        userId: req.user?._id,
        trustedDevice: verification.trustedDevice,
    });
    await persistMfaSession({ req, res, user, method: MFA_METHODS.PASSKEY });
    await invalidateUserCache(req.authUid || '');
    await invalidateUserCacheByEmail(user?.email || '');
    recordAuthSecurityEvent({
        event: 'mfa.passkey.registered',
        outcome: 'success',
        reason: 'none',
        surface: 'mfa',
        req,
    });
    return respondWithAuthenticatedSession({
        req,
        res,
        user,
        method: MFA_METHODS.PASSKEY,
        message: 'Passkey registered.',
    });
});

const passkeyLoginOptions = asyncHandler(async (req, res) => {
    assertMfaFeature({ method: MFA_METHODS.PASSKEY });
    const { deviceId, deviceLabel } = extractTrustedDeviceContext(req);
    if (!deviceId) throw new AppError('Trusted device identity is missing.', 400);
    if (!getTrustedDeviceRegistration(req.user, deviceId)) {
        throw new AppError('Registered passkey is required for this device.', 404);
    }
    const challenge = await issueTrustedDeviceChallenge({
        user: req.user,
        authUid: req.authUid || '',
        authToken: req.authToken || null,
        deviceId,
        deviceLabel,
        req,
        allowEnrollment: false,
        challengeScope: 'mfa-passkey-login',
    });
    res.status(201).json({ success: true, deviceChallenge: challenge });
});

const passkeyLoginVerify = asyncHandler(async (req, res) => {
    assertMfaFeature({ method: MFA_METHODS.PASSKEY });
    const challengeId = normalizeText(req.body?.challengeId || req.body?.mfaChallengeId);
    if (challengeId) {
        const consumed = await consumeMfaChallenge({
            challengeId,
            userId: req.user?._id,
            method: MFA_METHODS.PASSKEY,
            purpose: normalizeText(req.body?.purpose) || 'login',
            action: normalizeText(req.body?.action),
        });
        if (!consumed.success) throw new AppError('MFA challenge is invalid or expired.', 401);
    }
    const verification = await verifyPasskeyChallenge({ req, expectedScope: 'mfa-passkey-login' });
    const user = await syncPasskeyMfaState({
        userId: req.user?._id,
        trustedDevice: verification.trustedDevice,
    });
    await persistMfaSession({ req, res, user, method: MFA_METHODS.PASSKEY });
    await invalidateUserCache(req.authUid || '');
    await invalidateUserCacheByEmail(user?.email || '');
    recordAuthSecurityEvent({
        event: 'mfa.passkey.used',
        outcome: 'success',
        reason: 'none',
        surface: 'mfa',
        req,
    });
    return respondWithAuthenticatedSession({
        req,
        res,
        user,
        method: MFA_METHODS.PASSKEY,
        message: 'Passkey MFA verified.',
    });
});

const passkeyRemove = asyncHandler(async (req, res) => {
    assertMfaFeature({ method: MFA_METHODS.PASSKEY });
    const deviceId = normalizeText(req.body?.deviceId);
    const credentialId = normalizeText(req.body?.credentialId);
    if (!deviceId && !credentialId) throw new AppError('Passkey device ID or credential ID is required.', 400);

    const user = await User.findById(req.user?._id)
        .select('+mfa.passkeys.credentialId')
        .lean();
    const nextTrustedDevices = (user?.trustedDevices || []).filter((device) => (
        !(deviceId && normalizeText(device.deviceId) === deviceId)
        && !(credentialId && normalizeText(device.webauthnCredentialIdBase64Url) === credentialId)
    ));
    const nextPasskeys = (user?.mfa?.passkeys || []).filter((passkey) => (
        !(credentialId && normalizeText(passkey.credentialId) === credentialId)
    ));

    const updated = await User.findByIdAndUpdate(
        req.user?._id,
        {
            $set: {
                trustedDevices: nextTrustedDevices,
                'mfa.passkeys': nextPasskeys,
                'mfa.defaultMethod': nextPasskeys.length > 0 ? 'passkey' : (hasTotp(user) ? 'totp' : ''),
            },
        },
        {
            returnDocument: 'after',
            projection: MFA_PROFILE_PROJECTION,
            lean: true,
        }
    );
    await invalidateUserCache(req.authUid || '');
    await invalidateUserCacheByEmail(req.user?.email || '');
    recordAuthSecurityEvent({
        event: 'mfa.passkey.removed',
        outcome: 'success',
        reason: 'none',
        surface: 'mfa',
        req,
    });
    res.json({ success: true, mfa: buildMfaState(updated) });
});

const recoveryRegenerate = asyncHandler(async (req, res) => {
    assertMfaFeature({ method: MFA_METHODS.RECOVERY_CODE });
    const user = await getFreshUser(req.user?._id);
    if (!hasPasskey(user) && !hasTotp(user)) {
        throw new AppError('Add passkey or authenticator app MFA before generating recovery codes.', 409);
    }
    const result = await generateRecoveryCodes({
        userId: req.user?._id,
        requirePasskey: false,
    });
    await invalidateUserCache(req.authUid || '');
    await invalidateUserCacheByEmail(req.user?.email || '');
    recordAuthSecurityEvent({
        event: 'mfa.recovery.generated',
        outcome: 'success',
        reason: 'none',
        surface: 'mfa',
        req,
        meta: { activeCount: result.recoveryCodeState?.activeCount || 0 },
    });
    res.status(201).json({
        success: true,
        recoveryCodes: result.codes,
        recoveryCodeState: result.recoveryCodeState,
        recoveryReadiness: result.readiness,
    });
});

const recoveryVerify = asyncHandler(async (req, res) => {
    assertMfaFeature({ method: MFA_METHODS.RECOVERY_CODE });
    const challengeId = normalizeText(req.body?.challengeId || req.body?.challengeToken);
    const inspected = await inspectMfaChallenge({
        challengeId,
        userId: req.user?._id,
        method: MFA_METHODS.RECOVERY_CODE,
        purpose: normalizeText(req.body?.purpose) || 'login',
        action: normalizeText(req.body?.action),
    });
    if (!inspected.success) throw new AppError('MFA challenge is invalid or expired.', 401);

    let result;
    try {
        result = await verifyAndConsumeRecoveryCode({
            userId: req.user?._id,
            code: req.body?.code,
            purpose: `mfa:${inspected.challenge?.purpose || 'login'}`,
        });
    } catch (error) {
        recordAuthSecurityEvent({
            event: 'mfa.recovery.used',
            outcome: 'failure',
            reason: 'invalid',
            surface: 'mfa',
            req,
        });
        throw error;
    }

    const consumed = await consumeMfaChallenge({
        challengeId,
        userId: req.user?._id,
        method: MFA_METHODS.RECOVERY_CODE,
        purpose: inspected.challenge?.purpose || 'login',
        action: normalizeText(req.body?.action),
    });
    if (!consumed.success) throw new AppError('MFA challenge is invalid or expired.', 401);

    const user = result.user;
    await persistMfaSession({ req, res, user, method: MFA_METHODS.RECOVERY_CODE });
    await invalidateUserCache(req.authUid || '');
    await invalidateUserCacheByEmail(user?.email || '');
    recordAuthSecurityEvent({
        event: 'mfa.recovery.used',
        outcome: 'success',
        reason: 'none',
        surface: 'mfa',
        req,
        meta: { activeCount: result.recoveryCodeState?.activeCount || 0 },
    });
    return respondWithAuthenticatedSession({
        req,
        res,
        user,
        method: MFA_METHODS.RECOVERY_CODE,
        message: 'Recovery code MFA verified.',
    });
});

const createStepUpChallenge = asyncHandler(async (req, res) => {
    assertMfaFeature();
    const user = await getFreshUser(req.user?._id);
    const policy = evaluateAction({
        user,
        session: req.authSession || null,
        action: normalizeText(req.body?.action) || 'manual_step_up',
        route: normalizeText(req.body?.route || req.originalUrl),
    });
    const challenge = await createMfaChallenge({
        user,
        purpose: 'step_up',
        policy,
        req,
        action: policy.action || 'manual_step_up',
        returnTo: normalizeText(req.body?.returnTo),
    });
    recordAuthSecurityEvent({
        event: 'mfa.step_up.required',
        outcome: 'required',
        reason: policy.reason,
        surface: 'mfa',
        req,
        meta: { action: policy.action || '' },
    });
    res.status(403).json({
        success: false,
        requiresStepUpMfa: true,
        mfaChallenge: challenge,
        policy: buildPublicMfaPolicy(policy),
    });
});

module.exports = {
    buildMfaState,
    createStepUpChallenge,
    disableTotp,
    getMfaSecurityCenter,
    getTotpQr,
    passkeyLoginOptions,
    passkeyLoginVerify,
    passkeyRegisterOptions,
    passkeyRegisterVerify,
    passkeyRemove,
    recoveryRegenerate,
    recoveryVerify,
    setupTotp,
    verifyTotpLogin,
    verifyTotpSetup,
};

const asyncHandler = require('express-async-handler');
const User = require('../models/User');
const AppError = require('../utils/AppError');
const { buildSessionPayload } = require('../services/authSessionService');
const {
    SESSION_STEP_UP_TTL_MS,
    clearBrowserSessionCookie,
    refreshBrowserSession,
} = require('../services/browserSessionService');
const {
    extractTrustedDeviceContext,
    getTrustedDeviceRegistration,
    issueTrustedDeviceChallenge,
    verifyTrustedDeviceChallenge,
} = require('../services/trustedDeviceChallengeService');
const {
    isActiveTrustedDevice,
    renameTrustedDevice: renameTrustedDeviceRegistration,
    revokeTrustedDevices,
} = require('../services/trustedDeviceManagementService');
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
    isAdminSubject,
} = require('../services/mfaPolicyService');
const {
    generateRecoveryCodes,
    verifyAndConsumeRecoveryCode,
} = require('../services/recoveryCodeService');
const { resolveMfaConfig } = require('../config/mfaConfig');
const { recordAuthSecurityEvent } = require('../services/authSecurityTelemetryService');
const { hasObservedWebAuthnUserVerification } = require('../services/trustedDeviceAssuranceService');
const { invalidateUserCache, invalidateUserCacheByEmail } = require('../middleware/authMiddleware');
const {
    startTrafficBudgetCommit,
} = require('../middleware/requestTimeouts');

const MFA_PROFILE_PROJECTION = 'name email phone avatar gender dob bio isAdmin adminRoles isVerified isSeller sellerActivatedAt accountState moderation authAssurance authAssuranceAt trustedDevices recoveryCodeState mfa loyalty createdAt';

const normalizeText = (value) => String(value || '').trim();
const normalizeMethod = (value) => normalizeText(value).toLowerCase();
const ADMIN_ENROLLMENT_FACTOR_AMR = new Set([
    'firebase_mfa',
    'mfa',
    'otp',
    'totp',
    'duo',
    'duo_oidc',
    'recovery_code',
]);

const getStepUpExpiry = () => new Date(Date.now() + SESSION_STEP_UP_TTL_MS).toISOString();

const getFreshUser = async (userId) => User.findById(userId, MFA_PROFILE_PROJECTION).lean();

const hasFreshIndependentAdminEnrollmentFactor = (req = {}) => {
    if (!isAdminSubject(req.user)) return true;

    const now = Date.now();
    const authTimeSeconds = Number(req.authToken?.auth_time || 0);
    const tokenFresh = Number.isFinite(authTimeSeconds)
        && authTimeSeconds > 0
        && (now - (authTimeSeconds * 1000)) <= SESSION_STEP_UP_TTL_MS;
    const tokenSecondFactor = normalizeText(req.authToken?.firebase?.sign_in_second_factor);
    const tokenAmr = Array.isArray(req.authToken?.amr)
        ? req.authToken.amr.map(normalizeMethod)
        : [];
    if (
        tokenFresh
        && (tokenSecondFactor || tokenAmr.some((entry) => ADMIN_ENROLLMENT_FACTOR_AMR.has(entry)))
    ) {
        return true;
    }

    const stepUpUntil = req.authSession?.stepUpUntil
        ? new Date(req.authSession.stepUpUntil).getTime()
        : 0;
    if (!Number.isFinite(stepUpUntil) || stepUpUntil <= now) return false;
    const sessionAmr = Array.isArray(req.authSession?.amr)
        ? req.authSession.amr.map(normalizeMethod)
        : [];
    return sessionAmr.some((entry) => ADMIN_ENROLLMENT_FACTOR_AMR.has(entry));
};

const assertAdminPasskeyEnrollmentAssurance = (req = {}) => {
    if (hasFreshIndependentAdminEnrollmentFactor(req)) return;

    const error = new AppError(
        'Admin passkey enrollment requires a fresh independent MFA or supervised bootstrap.',
        403
    );
    error.code = 'ADMIN_PASSKEY_ENROLLMENT_ASSURANCE_REQUIRED';
    error.requiresMfa = true;
    throw error;
};

const buildPublicPasskeyChallenge = ({ challenge = null, user = null, purpose = 'login' } = {}) => {
    if (!challenge || typeof challenge !== 'object') return null;
    const adminAudience = isAdminSubject(user);
    return {
        ...challenge,
        audience: adminAudience ? 'admin' : 'public',
        surface: 'authentication',
        purpose,
        presentationPurpose: purpose === 'login' ? 'sign_in' : 'factor_enrollment',
        requiredAssurance: adminAudience ? 'admin_passkey' : 'mfa_passkey',
        blocking: true,
        exitMode: 'sign_out',
    };
};

const buildMfaState = (user = null, { currentDeviceId = '' } = {}) => {
    const trustedDevices = Array.isArray(user?.trustedDevices) ? user.trustedDevices : [];
    const normalizedCurrentDeviceId = normalizeText(currentDeviceId);
    const activeMfaCredentialIds = new Set(
        (Array.isArray(user?.mfa?.passkeys) ? user.mfa.passkeys : [])
            .filter((passkey) => !passkey?.revokedAt)
            .map((passkey) => normalizeText(passkey?.credentialId))
            .filter(Boolean)
    );
    const passkeys = trustedDevices.filter((device) => (
        isActiveTrustedDevice(device)
        && (
            normalizeMethod(device?.method) === 'webauthn'
            || Boolean(normalizeText(device?.webauthnCredentialIdBase64Url))
        )
        && hasObservedWebAuthnUserVerification(device)
        && (
            ['mfa', 'admin'].includes(normalizeMethod(device?.credentialScope))
            || activeMfaCredentialIds.has(normalizeText(device?.webauthnCredentialIdBase64Url))
        )
    ));
    const trustedDeviceViews = trustedDevices.map((device) => {
        const method = normalizeMethod(device.method)
            || (device.webauthnCredentialIdBase64Url ? 'webauthn' : 'browser_key');
        const isPasskey = method === 'webauthn';
        const active = isActiveTrustedDevice(device);
        const expiresAt = device.expiresAt ? new Date(device.expiresAt).getTime() : 0;
        const status = device.revokedAt
            ? 'revoked'
            : (Number.isFinite(expiresAt) && expiresAt > 0 && expiresAt <= Date.now() ? 'expired' : 'active');
        const credentialScope = isPasskey
            ? (normalizeMethod(device.credentialScope) || 'recognition')
            : 'recognition';
        const adminEligibility = isPasskey
            ? (normalizeMethod(device.adminEligibility) || 'none')
            : 'none';
        const isMfaFactor = Boolean(
            active
            && isPasskey
            && hasObservedWebAuthnUserVerification(device)
            && (
                ['mfa', 'admin'].includes(credentialScope)
                || activeMfaCredentialIds.has(normalizeText(device.webauthnCredentialIdBase64Url))
            )
        );
        const backupEligible = Boolean(device.webauthnBackupEligible);
        const backedUp = Boolean(device.webauthnBackedUp);

        return {
            deviceId: normalizeText(device.deviceId),
            label: normalizeText(device.label) || (isPasskey ? 'Passkey device' : 'Remembered browser'),
            method,
            status,
            active,
            isCurrent: Boolean(
                normalizedCurrentDeviceId
                && normalizeText(device.deviceId) === normalizedCurrentDeviceId
            ),
            isMfaFactor,
            credentialScope,
            adminEligibility,
            adminEligible: Boolean(
                active
                && isPasskey
                && credentialScope === 'admin'
                && adminEligibility === 'verified'
                && hasObservedWebAuthnUserVerification(device)
            ),
            userVerification: isPasskey ? normalizeMethod(device.webauthnUserVerification) : '',
            userVerified: isPasskey ? hasObservedWebAuthnUserVerification(device) : false,
            authenticatorAttachment: isPasskey ? normalizeMethod(device.authenticatorAttachment) : '',
            backupEligible,
            backedUp,
            syncState: backedUp ? 'synced' : (backupEligible ? 'eligible_not_synced' : 'device_bound_or_unknown'),
            createdAt: device.createdAt || null,
            lastSeenAt: device.lastSeenAt || null,
            lastVerifiedAt: device.lastVerifiedAt || null,
            expiresAt: device.expiresAt || null,
            revokedAt: device.revokedAt || null,
            canRename: active,
            canRevoke: active,
        };
    }).sort((left, right) => {
        if (left.isCurrent !== right.isCurrent) return left.isCurrent ? -1 : 1;
        if (left.active !== right.active) return left.active ? -1 : 1;
        return new Date(right.lastVerifiedAt || right.lastSeenAt || right.createdAt || 0).getTime()
            - new Date(left.lastVerifiedAt || left.lastSeenAt || left.createdAt || 0).getTime();
    });
    const activeTrustedDevices = trustedDeviceViews.filter((device) => device.active);

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
                    isCurrent: Boolean(
                        normalizedCurrentDeviceId
                        && normalizeText(device.deviceId) === normalizedCurrentDeviceId
                    ),
                    createdAt: device.createdAt || null,
                    lastUsedAt: device.lastVerifiedAt || device.lastSeenAt || null,
                    transports: Array.isArray(device.webauthnTransports) ? device.webauthnTransports : [],
                    backupEligible: Boolean(device.webauthnBackupEligible),
                    backedUp: Boolean(device.webauthnBackedUp),
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
        devicePolicy: {
            audience: isAdminSubject(user) ? 'admin' : 'public',
            currentDeviceBound: activeTrustedDevices.some((device) => device.isCurrent),
            activeCount: activeTrustedDevices.length,
            rememberedBrowserCount: activeTrustedDevices.filter((device) => device.method === 'browser_key').length,
            passkeyCount: activeTrustedDevices.filter((device) => device.method === 'webauthn').length,
            revokedOrExpiredCount: trustedDeviceViews.length - activeTrustedDevices.length,
        },
        trustedDevices: trustedDeviceViews,
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
    const stepUpUntil = getStepUpExpiry();
    if (!startTrafficBudgetCommit(req, res)) return null;
    const authSession = await refreshBrowserSession({
        req,
        res,
        currentSession: req.authSession || null,
        user,
        authUid: req.authUid || req.authToken?.uid || '',
        authToken: req.authToken || null,
        rotate: Boolean(req.authSession?.sessionId),
        deviceMethod: normalizedMethod === MFA_METHODS.PASSKEY ? 'webauthn' : '',
        stepUpUntil,
        webAuthnStepUpUntil: normalizedMethod === MFA_METHODS.PASSKEY ? stepUpUntil : null,
        additionalAmr,
        riskState,
    });
    req.authSession = authSession;
    return authSession;
};

const respondWithAuthenticatedSession = ({
    req,
    res,
    user,
    method,
    message = 'MFA verification successful.',
    deviceVerification = null,
} = {}) => {
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
        ...(deviceVerification?.deviceSessionToken
            ? {
                deviceSessionToken: deviceVerification.deviceSessionToken,
                expiresAt: deviceVerification.expiresAt || null,
            }
            : {}),
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
        mfa: buildMfaState(user, { currentDeviceId: req.authSession?.deviceId }),
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
        mfa: buildMfaState(user, { currentDeviceId: req.authSession?.deviceId }),
        policy: buildPublicMfaPolicy(loginPolicy),
    });
});

const setupTotp = asyncHandler(async (req, res) => {
    assertMfaFeature({ method: MFA_METHODS.TOTP });
    if (!startTrafficBudgetCommit(req, res)) return undefined;
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
    if (!startTrafficBudgetCommit(req, res)) return undefined;
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
        req,
    });
    if (!inspected.success) {
        throw new AppError('MFA challenge is invalid or expired.', 401);
    }
    if (!startTrafficBudgetCommit(req, res)) return undefined;

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
        req,
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
    if (!startTrafficBudgetCommit(req, res)) return undefined;
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
    assertAdminPasskeyEnrollmentAssurance(req);
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
        credentialScope: isAdminSubject(req.user) ? 'admin' : 'mfa',
        enrollmentContext: isAdminSubject(req.user) ? 'admin_step_up' : 'mfa_registration',
        adminEligibility: isAdminSubject(req.user) ? 'verified' : 'none',
    });
    res.status(201).json({
        success: true,
        deviceChallenge: buildPublicPasskeyChallenge({
            challenge,
            user: req.user,
            purpose: 'register',
        }),
    });
});

const syncPasskeyMfaState = async ({ userId, trustedDevice }) => {
    const credentialId = normalizeText(trustedDevice?.webauthnCredentialIdBase64Url);
    if (!credentialId) return getFreshUser(userId);
    if (!hasObservedWebAuthnUserVerification(trustedDevice)) {
        const error = new AppError('Passkey MFA requires authenticator user verification.', 403);
        error.code = 'PASSKEY_USER_VERIFICATION_REQUIRED';
        throw error;
    }
    const user = await User.findById(userId)
        .select('+mfa.passkeys.credentialId')
        .lean();
    if (!user?._id) throw new AppError('User not found.', 404);
    const now = new Date();
    const passkeyRecord = {
        credentialId,
        publicKey: '',
        counter: Number(trustedDevice?.webauthnCounter || 0),
        transports: Array.isArray(trustedDevice?.webauthnTransports) ? trustedDevice.webauthnTransports : [],
        deviceType: normalizeText(trustedDevice?.authenticatorAttachment),
        backupEligible: Boolean(trustedDevice?.webauthnBackupEligible),
        backedUp: Boolean(trustedDevice?.webauthnBackedUp),
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

    const updatedUser = await User.findOneAndUpdate(
        { _id: userId, __v: Number(user.__v || 0) },
        {
            $set: {
                'mfa.enabled': true,
                'mfa.defaultMethod': 'passkey',
                'mfa.lastMfaAt': now,
                'mfa.lastMfaMethod': 'passkey',
                'mfa.passkeys': nextPasskeys,
            },
            $inc: { __v: 1 },
        },
        {
            returnDocument: 'after',
            projection: MFA_PROFILE_PROJECTION,
            lean: true,
        }
    );
    if (!updatedUser) {
        const error = new AppError('Passkey state changed. Refresh and try again.', 409);
        error.code = 'TRUSTED_DEVICE_STATE_CHANGED';
        throw error;
    }
    return updatedUser;
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
    assertAdminPasskeyEnrollmentAssurance(req);
    if (!startTrafficBudgetCommit(req, res)) return undefined;
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
        deviceVerification: verification,
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
    res.status(201).json({
        success: true,
        deviceChallenge: buildPublicPasskeyChallenge({
            challenge,
            user: req.user,
            purpose: 'login',
        }),
    });
});

const passkeyLoginVerify = asyncHandler(async (req, res) => {
    assertMfaFeature({ method: MFA_METHODS.PASSKEY });
    const challengeId = normalizeText(req.body?.challengeId || req.body?.mfaChallengeId);
    let inspectedChallenge = null;
    if (challengeId) {
        const inspected = await inspectMfaChallenge({
            challengeId,
            userId: req.user?._id,
            method: MFA_METHODS.PASSKEY,
            purpose: normalizeText(req.body?.purpose) || 'login',
            action: normalizeText(req.body?.action),
            req,
        });
        if (!inspected.success) throw new AppError('MFA challenge is invalid or expired.', 401);
        inspectedChallenge = inspected.challenge || null;
    }
    if (!startTrafficBudgetCommit(req, res)) return undefined;
    const verification = await verifyPasskeyChallenge({ req, expectedScope: 'mfa-passkey-login' });
    if (challengeId) {
        const consumed = await consumeMfaChallenge({
            challengeId,
            userId: req.user?._id,
            method: MFA_METHODS.PASSKEY,
            purpose: inspectedChallenge?.purpose || normalizeText(req.body?.purpose) || 'login',
            action: normalizeText(req.body?.action),
            req,
        });
        if (!consumed.success) throw new AppError('MFA challenge is invalid or expired.', 401);
    }
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
        deviceVerification: verification,
    });
});

const passkeyRemove = asyncHandler(async (req, res) => {
    const deviceId = normalizeText(req.body?.deviceId);
    const credentialId = normalizeText(req.body?.credentialId);
    if (!startTrafficBudgetCommit(req, res)) return undefined;
    const result = await revokeTrustedDevices({
        userId: req.user?._id,
        deviceId,
        credentialId,
    });
    const revokedCurrentDevice = result.revokedDeviceIds.includes(normalizeText(req.authSession?.deviceId));
    if (revokedCurrentDevice) clearBrowserSessionCookie(res, req);
    await invalidateUserCache(req.authUid || '');
    await invalidateUserCacheByEmail(req.user?.email || '');
    recordAuthSecurityEvent({
        event: 'mfa.passkey.removed',
        outcome: 'success',
        reason: 'none',
        surface: 'mfa',
        req,
        meta: {
            revokedSessions: result.revokedSessions,
            currentDevice: revokedCurrentDevice,
        },
    });
    res.json({
        success: true,
        revokedCurrentDevice,
        revokedDeviceIds: result.revokedDeviceIds,
        revokedSessions: result.revokedSessions,
        mfa: buildMfaState(result.user, { currentDeviceId: req.authSession?.deviceId }),
    });
});

const renameTrustedDevice = asyncHandler(async (req, res) => {
    if (!startTrafficBudgetCommit(req, res)) return undefined;
    const result = await renameTrustedDeviceRegistration({
        userId: req.user?._id,
        deviceId: req.params?.deviceId,
        label: req.body?.label,
    });
    await invalidateUserCache(req.authUid || '');
    await invalidateUserCacheByEmail(req.user?.email || '');
    recordAuthSecurityEvent({
        event: 'trusted_device.renamed',
        outcome: 'success',
        reason: 'none',
        surface: 'mfa',
        req,
    });
    res.json({
        success: true,
        trustedDevice: {
            deviceId: result.deviceId,
            label: result.label,
        },
        mfa: buildMfaState(result.user, { currentDeviceId: req.authSession?.deviceId }),
    });
});

const revokeTrustedDevice = asyncHandler(async (req, res) => {
    if (!startTrafficBudgetCommit(req, res)) return undefined;
    const result = await revokeTrustedDevices({
        userId: req.user?._id,
        deviceId: req.params?.deviceId,
    });
    const revokedCurrentDevice = result.revokedDeviceIds.includes(normalizeText(req.authSession?.deviceId));
    if (revokedCurrentDevice) clearBrowserSessionCookie(res, req);
    await invalidateUserCache(req.authUid || '');
    await invalidateUserCacheByEmail(req.user?.email || '');
    recordAuthSecurityEvent({
        event: 'trusted_device.revoked',
        outcome: 'success',
        reason: 'none',
        surface: 'mfa',
        req,
        meta: {
            revokedSessions: result.revokedSessions,
            currentDevice: revokedCurrentDevice,
        },
    });
    res.json({
        success: true,
        revokedCurrentDevice,
        revokedDeviceIds: result.revokedDeviceIds,
        revokedSessions: result.revokedSessions,
        mfa: buildMfaState(result.user, { currentDeviceId: req.authSession?.deviceId }),
    });
});

const revokeOtherTrustedDevices = asyncHandler(async (req, res) => {
    if (!startTrafficBudgetCommit(req, res)) return undefined;
    const result = await revokeTrustedDevices({
        userId: req.user?._id,
        currentDeviceId: req.authSession?.deviceId,
        revokeAllOthers: true,
    });
    await invalidateUserCache(req.authUid || '');
    await invalidateUserCacheByEmail(req.user?.email || '');
    recordAuthSecurityEvent({
        event: 'trusted_device.others_revoked',
        outcome: 'success',
        reason: 'none',
        surface: 'mfa',
        req,
        meta: {
            revokedDevices: result.revokedDeviceIds.length,
            revokedSessions: result.revokedSessions,
        },
    });
    res.json({
        success: true,
        revokedDeviceIds: result.revokedDeviceIds,
        revokedSessions: result.revokedSessions,
        mfa: buildMfaState(result.user, { currentDeviceId: req.authSession?.deviceId }),
    });
});

const recoveryRegenerate = asyncHandler(async (req, res) => {
    assertMfaFeature({ method: MFA_METHODS.RECOVERY_CODE });
    const user = await getFreshUser(req.user?._id);
    if (!hasPasskey(user) && !hasTotp(user)) {
        throw new AppError('Add passkey or authenticator app MFA before generating recovery codes.', 409);
    }
    if (!startTrafficBudgetCommit(req, res)) return undefined;
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
        req,
    });
    if (!inspected.success) throw new AppError('MFA challenge is invalid or expired.', 401);
    if (!startTrafficBudgetCommit(req, res)) return undefined;

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
        req,
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
    if (!startTrafficBudgetCommit(req, res)) return undefined;
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
    assertAdminPasskeyEnrollmentAssurance,
    buildMfaState,
    createStepUpChallenge,
    disableTotp,
    getMfaSecurityCenter,
    getTotpQr,
    hasFreshIndependentAdminEnrollmentFactor,
    passkeyLoginOptions,
    passkeyLoginVerify,
    passkeyRegisterOptions,
    passkeyRegisterVerify,
    passkeyRemove,
    renameTrustedDevice,
    recoveryRegenerate,
    recoveryVerify,
    revokeOtherTrustedDevices,
    revokeTrustedDevice,
    setupTotp,
    syncPasskeyMfaState,
    verifyTotpLogin,
    verifyTotpSetup,
};

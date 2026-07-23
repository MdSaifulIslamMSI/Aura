const mongoose = require('mongoose');
const asyncHandler = require('express-async-handler');
const firebaseAdmin = require('../config/firebase');
const User = require('../models/User');
const AppError = require('../utils/AppError');
const logger = require('../utils/logger');
const { resolveAdminSecurityConfig } = require('../config/adminSecurityConfig');
const {
    clearBrowserSessionCookie,
    parseCookies,
    refreshBrowserSession,
    revokeBrowserSession,
    revokeBrowserSessionsForUser,
} = require('../services/browserSessionService');
const {
    extractTrustedDeviceContext,
    issueTrustedDeviceChallenge,
} = require('../services/trustedDeviceChallengeService');
const {
    syncPasskeyMfaState,
    verifyPasskeyChallenge,
} = require('./mfaController');
const {
    ADMIN_SECURITY_STATES,
    getAuthAgeSeconds,
    getVerifiedAdminPasskeys,
    isAllowlistedAdmin,
    resolveAdminSecurityState,
} = require('../services/adminSecurityStateService');
const {
    consumeReservedRecoveryGrant,
    exchangeAdminRecoveryGrant,
    getActiveRecoveryAuthority,
    recordAdminSecurityAudit,
    releaseReservedRecoveryGrant,
    reserveRecoveryGrant,
    revokeRecoveryGrant,
} = require('../services/adminRecoveryGrantService');
const { recordAuthSecurityEvent } = require('../services/authSecurityTelemetryService');
const {
    cacheUserAuthTokensRevokedAfter,
    invalidateUserCache,
    invalidateUserCacheByEmail,
} = require('../middleware/authMiddleware');

const ADMIN_SECURITY_PROJECTION = 'name email authUid isAdmin adminRoles isVerified accountState softDeleted trustedDevices mfa adminSecurityVersion authTokensRevokedAfter';

const securityError = (message, code, statusCode = 403) => {
    const error = new AppError(message, statusCode);
    error.code = code;
    return error;
};

const getFreshUser = async (userId, mongoSession = null) => {
    const query = User.findById(userId, ADMIN_SECURITY_PROJECTION);
    if (mongoSession) query.session(mongoSession);
    return query.lean();
};

const getRecoveryCookie = (req = {}) => {
    const config = resolveAdminSecurityConfig();
    return String(parseCookies(req.headers?.cookie || '')[config.recoveryCookieName] || '').trim();
};

const getSessionId = (req = {}) => String(req.authSession?.sessionId || '').trim();

const setRecoveryCookie = (req, res, authority, expiresAt) => {
    const config = resolveAdminSecurityConfig();
    const requestOrigin = String(req.headers?.origin || '').trim();
    const requestHost = String(req.headers?.host || '').trim();
    const crossSite = Boolean(requestOrigin && requestHost && !requestOrigin.includes(requestHost));
    res.cookie(config.recoveryCookieName, authority, {
        httpOnly: true,
        secure: config.production || req.secure === true,
        sameSite: crossSite ? 'none' : 'strict',
        path: '/api/admin/security',
        expires: expiresAt,
    });
};

const clearRecoveryCookie = (req, res) => {
    const config = resolveAdminSecurityConfig();
    const requestOrigin = String(req.headers?.origin || '').trim();
    const requestHost = String(req.headers?.host || '').trim();
    const crossSite = Boolean(requestOrigin && requestHost && !requestOrigin.includes(requestHost));
    res.clearCookie(config.recoveryCookieName, {
        httpOnly: true,
        secure: config.production || req.secure === true,
        sameSite: crossSite ? 'none' : 'strict',
        path: '/api/admin/security',
    });
};

const assertFeature = (flag, code) => {
    const config = resolveAdminSecurityConfig();
    if (!config.stateEngineV2 || !config[flag]) {
        throw securityError('This admin security capability is not enabled.', code, 403);
    }
    return config;
};

const assertRecoverySubject = ({ req, user, config }) => {
    const identityEmailVerified = Boolean(
        req.authIdentity?.emailVerified
        ?? req.authToken?.email_verified
        ?? false
    );
    if (!user?._id || !user.isVerified || !identityEmailVerified || !isAllowlistedAdmin(user)) {
        throw securityError('Recovery authority is not available for this account.', 'ADMIN_RECOVERY_NOT_AUTHORIZED');
    }
    if (getAuthAgeSeconds(req) > config.freshPrimaryAuthSeconds) {
        throw securityError('Sign in again before using an admin recovery grant.', 'ADMIN_PRIMARY_REAUTH_REQUIRED', 401);
    }
    if (!getSessionId(req)) {
        throw securityError('A browser session is required for admin recovery.', 'ADMIN_RECOVERY_SESSION_REQUIRED', 401);
    }
};

const getActiveAuthority = async ({ req, user }) => getActiveRecoveryAuthority({
    authority: getRecoveryCookie(req),
    user,
    sessionId: getSessionId(req),
});

const buildPublicChallenge = (challenge, purpose) => ({
    ...challenge,
    audience: 'admin',
    surface: 'admin_security',
    purpose,
    presentationPurpose: purpose === 'challenge' ? 'admin_verification' : 'factor_enrollment',
    requiredAssurance: 'admin_passkey',
    blocking: true,
    exitMode: 'sign_out',
});

const getAdminSecurityStatus = asyncHandler(async (req, res) => {
    const user = req.user?._id ? await getFreshUser(req.user._id) : null;
    if (user) req.user = user;
    const authority = user ? await getActiveAuthority({ req, user }) : null;
    const evaluation = resolveAdminSecurityState({
        req,
        user,
        recoveryAuthorityActive: Boolean(authority),
    });
    res.setHeader('Cache-Control', 'no-store');
    res.json({
        success: true,
        requestId: req.requestId || '',
        ...evaluation,
    });
});

const exchangeRecoveryGrant = asyncHandler(async (req, res) => {
    const config = assertFeature('recoveryGrants', 'ADMIN_RECOVERY_GRANTS_DISABLED');
    const user = await getFreshUser(req.user?._id);
    assertRecoverySubject({ req, user, config });
    const plaintextToken = String(req.body?.grant || req.body?.token || '').trim();
    if (plaintextToken.length < 32 || plaintextToken.length > 256) {
        throw securityError('The recovery grant is invalid or expired.', 'ADMIN_RECOVERY_GRANT_INVALID');
    }

    const exchanged = await exchangeAdminRecoveryGrant({
        plaintextToken,
        user,
        sessionId: getSessionId(req),
    });
    if (!exchanged) {
        recordAuthSecurityEvent({
            event: 'admin.recovery.exchange',
            outcome: 'blocked',
            reason: 'invalid',
            surface: 'recovery',
            req,
        });
        throw securityError('The recovery grant is invalid or expired.', 'ADMIN_RECOVERY_GRANT_INVALID');
    }

    try {
        await recordAdminSecurityAudit({
            event: 'admin_recovery_grant_exchanged',
            outcome: 'success',
            reasonCode: 'session_bound_authority_issued',
            subjectUser: user._id,
            grantId: exchanged.grant.grantId,
            req,
        });
    } catch (error) {
        await revokeRecoveryGrant({ grantId: exchanged.grant.grantId, user }).catch(() => {});
        throw securityError('Recovery authority could not be audited and was revoked.', 'ADMIN_RECOVERY_AUDIT_FAILED', 503);
    }
    setRecoveryCookie(req, res, exchanged.authority, exchanged.authorityExpiresAt);
    recordAuthSecurityEvent({
        event: 'admin.recovery.exchange',
        outcome: 'success',
        reason: 'none',
        surface: 'recovery',
        req,
    });
    res.setHeader('Cache-Control', 'no-store');
    res.json({
        success: true,
        state: ADMIN_SECURITY_STATES.ADMIN_ENROLLMENT_REQUIRED,
        authorityExpiresAt: exchanged.authorityExpiresAt,
        allowedMethods: exchanged.grant.allowedMethods,
        requestId: req.requestId || '',
    });
});

const startAdminPasskeyEnrollment = asyncHandler(async (req, res) => {
    const config = assertFeature('passkeyEnrollment', 'ADMIN_PASSKEY_ENROLLMENT_DISABLED');
    const user = await getFreshUser(req.user?._id);
    assertRecoverySubject({ req, user, config });
    const authority = await getActiveAuthority({ req, user });
    if (!authority || authority.state !== 'exchanged') {
        throw securityError('A valid recovery authority is required for passkey enrollment.', 'ADMIN_RECOVERY_AUTHORITY_REQUIRED');
    }

    const { deviceId, deviceLabel } = extractTrustedDeviceContext(req);
    if (!deviceId) throw securityError('Trusted device identity is missing.', 'ADMIN_DEVICE_ID_REQUIRED', 400);
    const challenge = await issueTrustedDeviceChallenge({
        user,
        authUid: req.authUid || '',
        authToken: req.authToken || null,
        deviceId,
        deviceLabel,
        req,
        allowEnrollment: true,
        forceEnrollment: true,
        challengeScope: 'admin-passkey-recovery-enroll',
        credentialScope: 'admin',
        enrollmentContext: 'operator_bootstrap',
        adminEligibility: 'verified',
    });
    res.status(201).json({
        success: true,
        deviceChallenge: buildPublicChallenge(challenge, 'enroll'),
        authorityExpiresAt: authority.authorityExpiresAt,
    });
});

const completeAdminPasskeyEnrollment = asyncHandler(async (req, res) => {
    const config = assertFeature('passkeyEnrollment', 'ADMIN_PASSKEY_ENROLLMENT_DISABLED');
    const user = await getFreshUser(req.user?._id);
    assertRecoverySubject({ req, user, config });
    const authority = await getActiveAuthority({ req, user });
    if (!authority || authority.state !== 'exchanged') {
        throw securityError('A valid recovery authority is required for passkey enrollment.', 'ADMIN_RECOVERY_AUTHORITY_REQUIRED');
    }

    const reserved = await reserveRecoveryGrant({ grantId: authority.grantId, user });
    if (!reserved) {
        throw securityError('The recovery grant is already in use or expired.', 'ADMIN_RECOVERY_GRANT_ALREADY_USED', 409);
    }

    const mongoSession = await mongoose.startSession();
    const revokedAt = new Date();
    let enrolledUser = null;
    try {
        mongoSession.startTransaction();
        const verification = await verifyPasskeyChallenge({
            req,
            expectedScope: 'admin-passkey-recovery-enroll',
            mongoSession,
        });
        if (
            verification.trustedDevice?.credentialScope !== 'admin'
            || verification.trustedDevice?.adminEligibility !== 'verified'
            || verification.trustedDevice?.webauthnUserVerified !== true
        ) {
            throw securityError('The passkey did not satisfy admin enrollment policy.', 'ADMIN_PASSKEY_ENROLLMENT_INVALID');
        }
        enrolledUser = await syncPasskeyMfaState({
            userId: user._id,
            trustedDevice: verification.trustedDevice,
            mongoSession,
        });
        const consumed = await consumeReservedRecoveryGrant({
            grantId: authority.grantId,
            user,
            mongoSession,
            now: revokedAt,
        });
        if (!consumed) {
            throw securityError('The recovery grant could not be consumed.', 'ADMIN_RECOVERY_GRANT_CONSUME_FAILED', 409);
        }
        const versionWrite = await User.updateOne(
            { _id: user._id },
            {
                $set: { authTokensRevokedAfter: revokedAt },
                $inc: { adminSecurityVersion: 1 },
            },
            { session: mongoSession }
        );
        if (Number(versionWrite?.modifiedCount || 0) !== 1) {
            throw securityError('The admin security version could not be advanced.', 'ADMIN_SECURITY_VERSION_UPDATE_FAILED', 409);
        }
        await recordAdminSecurityAudit({
            event: 'admin_passkey_recovery_enrolled',
            outcome: 'consumed',
            reasonCode: 'recovery_committed_session_revocation_required',
            subjectUser: user._id,
            grantId: authority.grantId,
            req,
            metadata: {
                method: 'passkey',
                requiresFreshSignIn: true,
            },
            mongoSession,
        });
        await mongoSession.commitTransaction();
    } catch (error) {
        await mongoSession.abortTransaction().catch(() => {});
        await releaseReservedRecoveryGrant({ grantId: authority.grantId }).catch(() => {});
        throw error;
    } finally {
        await mongoSession.endSession();
    }

    let cleanupPending = false;
    try {
        await revokeBrowserSessionsForUser(user._id);
    } catch (error) {
        cleanupPending = true;
        logger.error('admin_security.browser_session_revoke_failed', {
            requestId: req.requestId || '',
            code: error?.code || '',
        });
    }
    const cached = await cacheUserAuthTokensRevokedAfter(req.authUid || user.authUid || '', revokedAt);
    if (!cached) cleanupPending = true;
    await invalidateUserCache(req.authUid || user.authUid || '');
    await invalidateUserCacheByEmail(user.email || '');
    if (user.authUid) {
        try {
            await firebaseAdmin.auth().revokeRefreshTokens(user.authUid);
        } catch (error) {
            cleanupPending = true;
            logger.error('admin_security.firebase_session_revoke_failed', {
                requestId: req.requestId || '',
                providerCode: error?.code || '',
            });
        }
    }
    clearRecoveryCookie(req, res);
    clearBrowserSessionCookie(res, req);
    recordAuthSecurityEvent({
        event: 'admin.recovery.enrollment',
        outcome: 'success',
        reason: cleanupPending ? 'cleanup pending' : 'none',
        surface: 'recovery',
        req,
        meta: { method: 'passkey' },
    });
    res.status(201).json({
        success: true,
        message: 'Admin passkey enrolled. Sign in again to establish a new admin session.',
        requiresFreshSignIn: true,
        sessionCleanupPending: cleanupPending,
        adminSecurityVersion: Number(enrolledUser?.adminSecurityVersion || user.adminSecurityVersion || 0) + 1,
        requestId: req.requestId || '',
    });
});

const startAdminPasskeyChallenge = asyncHandler(async (req, res) => {
    assertFeature('passkeyChallenge', 'ADMIN_PASSKEY_CHALLENGE_DISABLED');
    const user = await getFreshUser(req.user?._id);
    const state = resolveAdminSecurityState({ req, user });
    if (!state.account.authorizedAdmin || !state.account.active || !state.account.emailVerified) {
        throw securityError('This account is not eligible for admin verification.', 'ADMIN_CHALLENGE_NOT_AUTHORIZED');
    }
    if (state.state === ADMIN_SECURITY_STATES.PRIMARY_REAUTH_REQUIRED) {
        throw securityError('Sign in again before verifying admin access.', 'ADMIN_PRIMARY_REAUTH_REQUIRED', 401);
    }
    const { deviceId, deviceLabel } = extractTrustedDeviceContext(req);
    const passkeys = getVerifiedAdminPasskeys(user);
    if (!passkeys.some((device) => String(device.deviceId) === String(deviceId))) {
        throw securityError('No approved admin passkey is registered for this browser.', 'ADMIN_PASSKEY_NOT_AVAILABLE_ON_DEVICE');
    }
    const challenge = await issueTrustedDeviceChallenge({
        user,
        authUid: req.authUid || '',
        authToken: req.authToken || null,
        deviceId,
        deviceLabel,
        req,
        allowEnrollment: false,
        challengeScope: 'admin-passkey-challenge',
    });
    res.status(201).json({
        success: true,
        deviceChallenge: buildPublicChallenge(challenge, 'challenge'),
    });
});

const completeAdminPasskeyChallenge = asyncHandler(async (req, res) => {
    const config = assertFeature('passkeyChallenge', 'ADMIN_PASSKEY_CHALLENGE_DISABLED');
    const user = await getFreshUser(req.user?._id);
    const state = resolveAdminSecurityState({ req, user });
    if (!state.account.authorizedAdmin || !state.account.active || !state.account.emailVerified) {
        throw securityError('This account is not eligible for admin verification.', 'ADMIN_CHALLENGE_NOT_AUTHORIZED');
    }
    if (state.state === ADMIN_SECURITY_STATES.PRIMARY_REAUTH_REQUIRED) {
        throw securityError('Sign in again before verifying admin access.', 'ADMIN_PRIMARY_REAUTH_REQUIRED', 401);
    }
    const verification = await verifyPasskeyChallenge({ req, expectedScope: 'admin-passkey-challenge' });
    const approved = getVerifiedAdminPasskeys({ trustedDevices: [verification.trustedDevice] }, {
        legacyFactorRead: config.legacyFactorRead,
    }).length === 1;
    if (!approved) {
        throw securityError('This passkey is not approved for admin access.', 'ADMIN_PASSKEY_NOT_APPROVED');
    }
    const assuranceExpiresAt = new Date(Date.now() + (config.assuranceTtlSeconds * 1000)).toISOString();
    req.authSession = await refreshBrowserSession({
        req,
        res,
        currentSession: req.authSession || null,
        user,
        authUid: req.authUid || user.authUid || '',
        authToken: req.authToken || null,
        rotate: Boolean(req.authSession?.sessionId),
        deviceMethod: 'webauthn',
        stepUpUntil: assuranceExpiresAt,
        webAuthnStepUpUntil: assuranceExpiresAt,
        additionalAmr: ['webauthn', 'passkey', 'mfa', 'admin_assurance'],
        riskState: 'privileged',
    });
    await invalidateUserCache(req.authUid || user.authUid || '');
    try {
        await recordAdminSecurityAudit({
            event: 'admin_passkey_challenge_verified',
            outcome: 'success',
            reasonCode: 'session_bound_assurance_issued',
            subjectUser: user._id,
            req,
            metadata: { method: 'passkey', assuranceExpiresAt },
        });
    } catch (error) {
        await revokeBrowserSession(req.authSession?.sessionId || '').catch(() => {});
        clearBrowserSessionCookie(res, req);
        throw securityError('Admin assurance could not be audited and was revoked.', 'ADMIN_ASSURANCE_AUDIT_FAILED', 503);
    }
    res.json({
        success: true,
        state: ADMIN_SECURITY_STATES.ADMIN_VERIFIED,
        assuranceExpiresAt,
        requestId: req.requestId || '',
    });
});

module.exports = {
    completeAdminPasskeyChallenge,
    completeAdminPasskeyEnrollment,
    exchangeRecoveryGrant,
    getAdminSecurityStatus,
    startAdminPasskeyChallenge,
    startAdminPasskeyEnrollment,
};

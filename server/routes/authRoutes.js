const crypto = require('crypto');
const express = require('express');
const { rateLimit } = require('express-rate-limit');
const {
    establishSessionCookie,
    generateBackupRecoveryCodes,
    getSession,
    logoutSession,
    requestBootstrapDeviceChallenge,
    syncSession,
    completePhoneFactorLogin,
    completePhoneFactorVerification,
    completeDuoLogin,
    completeEnterpriseLogin,
    verifyBackupRecoveryCode,
    verifyDeviceChallenge,
    issueDesktopHandoffToken,
    prepareDesktopHandoff,
    issueDesktopOwnerAccessToken,
    startEnterpriseLogin,
    startDuoLogin,
    startDuoStepUp,
} = require('../controllers/authController');
const {
    createStepUpChallenge,
    disableTotp,
    getMfaSecurityCenter,
    getTotpQr,
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
    verifyTotpLogin,
    verifyTotpSetup,
} = require('../controllers/mfaController');
const { protect, protectOptional, protectPhoneFactorProof } = require('../middleware/authMiddleware');
const validate = require('../middleware/validate');
const { sensitiveActions } = require('../middleware/routeSecurityGuards');
const { loginSchema } = require('../validators/userValidators');
const { createDistributedRateLimit } = require('../middleware/distributedRateLimit');
const {
    csrfTokenGenerator,
    csrfTokenValidator,
    csrfTokenValidatorUnlessBearerAuth,
} = require('../middleware/csrfMiddleware');
const { requireTurnstile } = require('../middleware/turnstileMiddleware');
const { startTrafficBudgetCommit } = require('../middleware/requestTimeouts');
const otpRoutes = require('./otpRoutes');

const router = express.Router();

const csrfTokenValidatorForCookieSession = (req, res, next) => {
    if (!req.authSession?.sessionId) {
        return next();
    }
    return csrfTokenValidator(req, res, next);
};

// Keep authentication and abuse admission inside the route budget, then claim
// the response before consuming one-time proofs or rotating session state.
// Either admission times out and nothing below runs, or the auth operation is
// allowed to finish without a late timeout response racing its mutation.
const beginAtomicAuthResponse = (req, res, next) => {
    if (!startTrafficBudgetCommit(req, res)) return undefined;
    return next();
};

const normalizeRateLimitEmail = (value) => (
    typeof value === 'string' ? value.trim().toLowerCase() : ''
);

const normalizeRateLimitPhone = (value) => (
    typeof value === 'string' ? value.trim().replace(/[\s\-()]/g, '') : ''
);

const hashRateLimitKeyPart = (value) => crypto
    .createHash('sha256')
    .update(String(value || ''))
    .digest('hex')
    .slice(0, 32);

const getRateLimitIp = (req) => String(
    req.ip || req.socket?.remoteAddress || 'unknown'
).trim();

const bootstrapChallengeRateLimitKey = (req) => {
    const email = normalizeRateLimitEmail(req.body?.email);
    const phone = normalizeRateLimitPhone(req.body?.phone);
    const accountKey = email || phone || 'anonymous';
    return `${accountKey}:${req.ip || 'unknown'}`;
};

const authGuardRateLimit = rateLimit({
    windowMs: 5 * 60 * 1000,
    limit: process.env.NODE_ENV === 'development' ? 1000 : 500,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    skip: () => process.env.NODE_ENV === 'test',
    message: { message: 'Too many authentication requests. Please try again shortly.' },
});

const authSyncLimiter = createDistributedRateLimit({
    securityCritical: true,
    name: 'auth_sync',
    windowMs: 15 * 60 * 1000,
    max: process.env.NODE_ENV === 'development' ? 600 : 200,
    message: 'Too many session sync requests, please try again after 15 minutes',
    keyGenerator: (req) => {
        if (req.authUid) return `uid:${req.authUid}`;
        if (req.user?.email) return `email:${String(req.user.email).trim().toLowerCase()}`;
        const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
        return email || req.ip;
    },
});

const recoveryCodeLimiter = createDistributedRateLimit({
    allowInMemoryFallback: process.env.NODE_ENV !== 'production',
    securityCritical: true,
    name: 'auth_recovery_code',
    windowMs: 15 * 60 * 1000,
    max: process.env.NODE_ENV === 'development' ? 120 : 20,
    message: 'Too many recovery code attempts, please try again after 15 minutes',
    keyGenerator: (req) => {
        const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
        return email
            ? `account:${hashRateLimitKeyPart(email)}`
            : `ip:${hashRateLimitKeyPart(getRateLimitIp(req))}`;
    },
});

const recoveryCodeNetworkLimiter = createDistributedRateLimit({
    allowInMemoryFallback: process.env.NODE_ENV !== 'production',
    securityCritical: true,
    name: 'auth_recovery_code_ip_abuse',
    windowMs: 15 * 60 * 1000,
    max: process.env.NODE_ENV === 'development' ? 600 : 80,
    message: 'Too many recovery attempts from this network, please try again after 15 minutes',
    keyGenerator: (req) => `ip:${hashRateLimitKeyPart(getRateLimitIp(req))}`,
});

const bootstrapDeviceChallengeLimiter = createDistributedRateLimit({
    securityCritical: true,
    name: 'auth_bootstrap_device_challenge',
    windowMs: 5 * 60 * 1000,
    max: process.env.NODE_ENV === 'development' ? 300 : 30,
    message: 'Too many trusted device challenge requests, please try again after 5 minutes',
    keyGenerator: bootstrapChallengeRateLimitKey,
});

const phoneFactorCompletionLimiter = createDistributedRateLimit({
    securityCritical: true,
    name: 'auth_phone_factor_completion',
    windowMs: 5 * 60 * 1000,
    max: process.env.NODE_ENV === 'development' ? 300 : 30,
    message: 'Too many phone verification attempts, please try again after 5 minutes',
    keyGenerator: (req) => {
        if (req.authUid) return `uid:${req.authUid}`;
        if (req.user?.email) return `email:${String(req.user.email).trim().toLowerCase()}`;
        const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
        const deviceId = typeof req.headers?.['x-aura-device-id'] === 'string'
            ? req.headers['x-aura-device-id'].trim()
            : '';
        return [email, deviceId, req.ip].filter(Boolean).join(':');
    },
});

const trustedDeviceVerificationLimiter = createDistributedRateLimit({
    securityCritical: true,
    name: 'auth_verify_device',
    windowMs: 5 * 60 * 1000,
    max: process.env.NODE_ENV === 'development' ? 300 : 30,
    message: 'Too many trusted device verification attempts, please try again after 5 minutes',
    keyGenerator: (req) => {
        if (req.authUid) return `uid:${req.authUid}`;
        if (req.user?.email) return `email:${String(req.user.email).trim().toLowerCase()}`;
        const deviceId = typeof req.headers?.['x-aura-device-id'] === 'string'
            ? req.headers['x-aura-device-id'].trim()
            : '';
        return [deviceId, req.ip].filter(Boolean).join(':');
    },
});

const mfaChallengeLimiter = createDistributedRateLimit({
    securityCritical: true,
    name: 'auth_mfa_challenge',
    windowMs: 5 * 60 * 1000,
    max: process.env.NODE_ENV === 'development' ? 300 : 30,
    message: 'Too many MFA challenge requests, please try again after 5 minutes',
    keyGenerator: (req) => {
        if (req.authUid) return `uid:${req.authUid}`;
        if (req.user?.email) return `email:${String(req.user.email).trim().toLowerCase()}`;
        return req.ip;
    },
});

const mfaVerifyLimiter = createDistributedRateLimit({
    securityCritical: true,
    name: 'auth_mfa_verify',
    windowMs: 5 * 60 * 1000,
    max: process.env.NODE_ENV === 'development' ? 300 : 20,
    message: 'Too many MFA verification attempts, please try again after 5 minutes',
    keyGenerator: (req) => {
        if (req.authUid) return `uid:${req.authUid}`;
        if (req.user?.email) return `email:${String(req.user.email).trim().toLowerCase()}`;
        const challengeId = typeof req.body?.challengeId === 'string' ? req.body.challengeId.trim() : '';
        return [challengeId, req.ip].filter(Boolean).join(':');
    },
});

const duoOidcLimiter = createDistributedRateLimit({
    securityCritical: true,
    name: 'auth_duo_oidc',
    windowMs: 5 * 60 * 1000,
    max: process.env.NODE_ENV === 'development' ? 300 : 60,
    message: 'Too many Duo login attempts, please try again after 5 minutes',
    keyGenerator: (req) => req.ip,
});

const enterpriseOidcLimiter = createDistributedRateLimit({
    securityCritical: true,
    name: 'auth_enterprise_oidc',
    windowMs: 5 * 60 * 1000,
    max: process.env.NODE_ENV === 'development' ? 300 : 60,
    message: 'Too many enterprise login attempts, please try again after 5 minutes',
    keyGenerator: (req) => req.ip,
});

const desktopHandoffLimiter = createDistributedRateLimit({
    securityCritical: true,
    allowInMemoryFallback: process.env.NODE_ENV !== 'production',
    name: 'auth_desktop_handoff',
    windowMs: 5 * 60 * 1000,
    max: process.env.NODE_ENV === 'development' ? 300 : 30,
    message: 'Too many desktop sign-in handoff requests, please try again after 5 minutes',
    keyGenerator: (req) => {
        if (req.authUid) return `uid:${req.authUid}`;
        if (req.user?.email) return `email:${String(req.user.email).trim().toLowerCase()}`;
        return req.ip;
    },
});

const desktopOwnerAccessLimiter = createDistributedRateLimit({
    securityCritical: true,
    allowInMemoryFallback: process.env.NODE_ENV !== 'production',
    name: 'auth_desktop_owner_access',
    windowMs: 5 * 60 * 1000,
    max: process.env.NODE_ENV === 'development' ? 300 : 10,
    message: 'Too many desktop owner access requests, please try again after 5 minutes',
    keyGenerator: (req) => req.ip,
});

const authenticatedSessionMutationLimiter = createDistributedRateLimit({
    securityCritical: true,
    name: 'auth_session_mutation',
    windowMs: 5 * 60 * 1000,
    max: process.env.NODE_ENV === 'development' ? 300 : 60,
    message: 'Too many session mutation requests, please try again after 5 minutes',
    keyGenerator: (req) => req.authUid || req.user?.email || req.ip,
});

router.get('/duo/start', duoOidcLimiter, beginAtomicAuthResponse, startDuoLogin);
router.get('/duo/step-up', protect, duoOidcLimiter, beginAtomicAuthResponse, establishSessionCookie, startDuoStepUp);
router.get('/duo/callback', duoOidcLimiter, beginAtomicAuthResponse, completeDuoLogin);
router.get('/enterprise/start', enterpriseOidcLimiter, beginAtomicAuthResponse, startEnterpriseLogin);
router.get('/enterprise/callback', enterpriseOidcLimiter, beginAtomicAuthResponse, completeEnterpriseLogin);
router.post('/desktop-handoff/prepare', protect, desktopHandoffLimiter, beginAtomicAuthResponse, establishSessionCookie, csrfTokenValidatorUnlessBearerAuth, prepareDesktopHandoff);
router.post('/desktop-handoff/custom-token', protect, desktopHandoffLimiter, beginAtomicAuthResponse, establishSessionCookie, csrfTokenValidatorUnlessBearerAuth, issueDesktopHandoffToken);
router.post('/desktop-handoff/owner-access-token', desktopOwnerAccessLimiter, beginAtomicAuthResponse, issueDesktopOwnerAccessToken);
router.post('/exchange', protect, beginAtomicAuthResponse, establishSessionCookie, csrfTokenGenerator, getSession);
router.get('/session', protect, beginAtomicAuthResponse, establishSessionCookie, csrfTokenGenerator, getSession);
router.post('/sync', authGuardRateLimit, protect, authSyncLimiter, beginAtomicAuthResponse, csrfTokenValidatorUnlessBearerAuth, validate(loginSchema), syncSession);
router.post('/logout', protectOptional, authenticatedSessionMutationLimiter, beginAtomicAuthResponse, csrfTokenValidatorForCookieSession, logoutSession);
router.post('/bootstrap-device-challenge', requireTurnstile({ routeName: 'auth_bootstrap_device_challenge' }), bootstrapDeviceChallengeLimiter, beginAtomicAuthResponse, requestBootstrapDeviceChallenge);
router.post('/recovery-codes', protect, authenticatedSessionMutationLimiter, beginAtomicAuthResponse, establishSessionCookie, csrfTokenValidatorUnlessBearerAuth, sensitiveActions.accountRecoveryChange, generateBackupRecoveryCodes);
router.post('/recovery-codes/verify', authGuardRateLimit, requireTurnstile({ routeName: 'auth_recovery_code_verify' }), recoveryCodeNetworkLimiter, recoveryCodeLimiter, beginAtomicAuthResponse, verifyBackupRecoveryCode);
router.get('/mfa', authGuardRateLimit, protect, mfaChallengeLimiter, beginAtomicAuthResponse, establishSessionCookie, csrfTokenGenerator, getMfaSecurityCenter);
router.post('/mfa/step-up', authGuardRateLimit, protect, mfaChallengeLimiter, beginAtomicAuthResponse, establishSessionCookie, csrfTokenValidatorUnlessBearerAuth, createStepUpChallenge);
router.post('/mfa/totp/setup', authGuardRateLimit, protect, authenticatedSessionMutationLimiter, beginAtomicAuthResponse, establishSessionCookie, csrfTokenValidatorUnlessBearerAuth, sensitiveActions.authFactorChange, setupTotp);
router.get('/mfa/totp/qr', authGuardRateLimit, protect, mfaChallengeLimiter, beginAtomicAuthResponse, establishSessionCookie, sensitiveActions.authFactorChange, getTotpQr);
router.post('/mfa/totp/verify-setup', authGuardRateLimit, protect, mfaVerifyLimiter, beginAtomicAuthResponse, establishSessionCookie, csrfTokenValidatorUnlessBearerAuth, sensitiveActions.authFactorChange, verifyTotpSetup);
router.post('/mfa/totp/verify-login', authGuardRateLimit, protect, mfaVerifyLimiter, beginAtomicAuthResponse, csrfTokenValidatorUnlessBearerAuth, verifyTotpLogin);
router.post('/mfa/totp/disable', authGuardRateLimit, protect, authenticatedSessionMutationLimiter, beginAtomicAuthResponse, establishSessionCookie, csrfTokenValidatorUnlessBearerAuth, sensitiveActions.authFactorChange, disableTotp);
router.post('/mfa/passkey/register/options', authGuardRateLimit, protect, mfaChallengeLimiter, beginAtomicAuthResponse, establishSessionCookie, csrfTokenValidatorUnlessBearerAuth, sensitiveActions.authFactorChange, passkeyRegisterOptions);
router.post('/mfa/passkey/register/verify', authGuardRateLimit, protect, trustedDeviceVerificationLimiter, beginAtomicAuthResponse, establishSessionCookie, csrfTokenValidatorUnlessBearerAuth, sensitiveActions.authFactorChange, passkeyRegisterVerify);
router.post('/mfa/passkey/login/options', authGuardRateLimit, protect, mfaChallengeLimiter, beginAtomicAuthResponse, csrfTokenValidatorUnlessBearerAuth, passkeyLoginOptions);
router.post('/mfa/passkey/login/verify', authGuardRateLimit, protect, trustedDeviceVerificationLimiter, beginAtomicAuthResponse, csrfTokenValidatorUnlessBearerAuth, passkeyLoginVerify);
router.post('/mfa/passkey/remove', authGuardRateLimit, protect, authenticatedSessionMutationLimiter, beginAtomicAuthResponse, establishSessionCookie, csrfTokenValidatorUnlessBearerAuth, sensitiveActions.authFactorChange, passkeyRemove);
router.patch('/mfa/trusted-devices/:deviceId', authGuardRateLimit, protect, authenticatedSessionMutationLimiter, beginAtomicAuthResponse, establishSessionCookie, csrfTokenValidatorUnlessBearerAuth, sensitiveActions.authFactorChange, renameTrustedDevice);
router.post('/mfa/trusted-devices/revoke-others', authGuardRateLimit, protect, authenticatedSessionMutationLimiter, beginAtomicAuthResponse, establishSessionCookie, csrfTokenValidatorUnlessBearerAuth, sensitiveActions.authFactorChange, revokeOtherTrustedDevices);
router.post('/mfa/trusted-devices/:deviceId/revoke', authGuardRateLimit, protect, authenticatedSessionMutationLimiter, beginAtomicAuthResponse, establishSessionCookie, csrfTokenValidatorUnlessBearerAuth, sensitiveActions.authFactorChange, revokeTrustedDevice);
router.post('/mfa/recovery/regenerate', authGuardRateLimit, protect, authenticatedSessionMutationLimiter, beginAtomicAuthResponse, establishSessionCookie, csrfTokenValidatorUnlessBearerAuth, sensitiveActions.accountRecoveryChange, recoveryRegenerate);
router.post('/mfa/recovery/verify', authGuardRateLimit, protect, mfaVerifyLimiter, beginAtomicAuthResponse, csrfTokenValidatorUnlessBearerAuth, recoveryVerify);
router.post('/complete-phone-factor-login', protect, phoneFactorCompletionLimiter, beginAtomicAuthResponse, sensitiveActions.authFactorChange, completePhoneFactorLogin);
router.post('/complete-phone-factor-verification', protectPhoneFactorProof, phoneFactorCompletionLimiter, beginAtomicAuthResponse, sensitiveActions.authFactorChange, completePhoneFactorVerification);
router.post('/verify-device', authGuardRateLimit, protect, trustedDeviceVerificationLimiter, beginAtomicAuthResponse, csrfTokenValidatorUnlessBearerAuth, verifyDeviceChallenge);
router.use('/otp', otpRoutes);

module.exports = router;

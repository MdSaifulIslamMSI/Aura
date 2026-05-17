const asyncHandler = require('express-async-handler');
const User = require('../models/User');
const {
    buildSessionPayload,
    persistAuthSnapshot,
    resolveAuthenticatedSession,
    syncAuthenticatedUser,
    applyLoginAssuranceToSession,
} = require('../services/authSessionService');
const { normalizePhoneE164 } = require('../services/sms');
const { invalidateUserCache, invalidateUserCacheByEmail } = require('../middleware/authMiddleware');
const { validatePasswordPolicy, detectWeakPasswordPatterns } = require('../utils/passwordValidator');
const AppError = require('../utils/AppError');
const {
    TRUSTED_DEVICE_SESSION_HEADER,
    extractTrustedDeviceChallengePayload,
    extractTrustedDeviceContext,
    getTrustedDeviceSessionToken,
    issueTrustedDeviceBootstrapChallenge,
    hashTrustedDeviceSessionToken,
    issueTrustedDeviceChallenge,
    resolveTrustedDeviceBootstrapSignal,
    verifyTrustedDeviceChallenge,
    verifyTrustedDeviceSession,
} = require('../services/trustedDeviceChallengeService');
const {
    clearBrowserSessionCookie,
    getBrowserSessionFromRequest,
    refreshBrowserSession,
    revokeBrowserSession,
} = require('../services/browserSessionService');
const {
    buildAuthorizationUrl: buildDuoAuthorizationUrl,
    clearStateCookie: clearDuoStateCookie,
    consumeState: consumeDuoState,
    exchangeCodeForClaims: exchangeDuoCodeForClaims,
} = require('../services/duoOidcService');
const { inspectOtpFlowToken, issueOtpFlowToken } = require('../utils/otpFlowToken');
const { registerOtpFlowGrant } = require('../services/otpFlowGrantService');
const {
    consumeRecoveryCodeForPasswordReset,
    generateRecoveryCodesForUser,
    getPasskeyCount,
} = require('../services/authRecoveryCodeService');
const {
    resolveProviderIds,
    resolveEmailVerifiedState,
} = require('../utils/authIdentity');
const { shouldRequireTrustedDevice } = require('../config/authTrustedDeviceFlags');
const { getLoginRuntimeEnforcementPolicy } = require('../config/loginRuntimeEnforcementPolicy');
const { RISK_LEVELS, evaluateLoginRisk } = require('../services/authRiskEngineService');
const { extractTrustedLoginRiskSignals } = require('../services/authRiskSignalService');
const { recordAuthSecurityEvent } = require('../services/authSecurityTelemetryService');
const { isEnabled: isEmergencyFlagEnabled } = require('../services/emergencyControlService');
const LOGIN_ASSURANCE_TTL_MS = 10 * 60 * 1000;
const PHONE_FACTOR_ASSURANCE_TTL_MS = 10 * 60 * 1000;
const GENERIC_PHONE_FACTOR_VERIFICATION_MESSAGE = 'If account details are valid, verification will proceed.';
const RECOVERY_CODE_VERIFICATION_MIN_MS = process.env.NODE_ENV === 'test' ? 0 : 350;
const LOGIN_RISK_STATE_HIGH = 'login_risk_high';

const normalizeEmail = (value) => (
    typeof value === 'string' ? value.trim().toLowerCase() : ''
);

const normalizeRelativeReturnTo = (value) => {
    const normalized = typeof value === 'string' ? value.trim() : '';
    if (!normalized || !normalized.startsWith('/') || normalized.startsWith('//')) {
        return '/';
    }
    if (normalized.startsWith('/api/')) {
        return '/';
    }
    return normalized;
};

const resolveFrontendBaseUrl = () => {
    const candidates = [
        process.env.FRONTEND_URL,
        process.env.APP_PUBLIC_URL,
        process.env.VERCEL_FRONTEND_URL,
        process.env.NETLIFY_FRONTEND_URL,
        process.env.AWS_FRONTEND_URL,
    ];
    const selected = candidates.find((value) => typeof value === 'string' && value.trim());
    return selected ? selected.trim().replace(/\/+$/, '') : '';
};

const buildDuoFrontendRedirect = ({ returnTo = '/', status = 'success', reason = '' } = {}) => {
    const safeReturnTo = normalizeRelativeReturnTo(returnTo);
    const baseUrl = resolveFrontendBaseUrl();
    const redirectUrl = new URL(safeReturnTo, baseUrl || 'http://aura.local');
    redirectUrl.searchParams.set('duo', status);
    if (reason) {
        redirectUrl.searchParams.set('reason', reason);
    }
    const pathWithQuery = `${redirectUrl.pathname}${redirectUrl.search}${redirectUrl.hash}`;
    return baseUrl ? `${baseUrl}${pathWithQuery}` : pathWithQuery;
};

const canonicalizePhone = (value) => {
    try {
        return normalizePhoneE164(value);
    } catch {
        return '';
    }
};

const normalizePhoneFactorPurpose = (value) => {
    const normalized = String(value || '').trim().toLowerCase();
    if (['signup', 'forgot-password'].includes(normalized)) {
        return normalized;
    }
    return '';
};

const phoneFactorFlowError = () => new AppError(GENERIC_PHONE_FACTOR_VERIFICATION_MESSAGE, 403);

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const waitForRecoveryCodeVerificationWindow = async (startedAt) => {
    const elapsedMs = Date.now() - startedAt;
    const remainingMs = RECOVERY_CODE_VERIFICATION_MIN_MS - elapsedMs;
    if (remainingMs > 0) {
        await wait(remainingMs);
    }
};

const hasFreshPasskeySession = (req = {}) => {
    const deviceMethod = String(req.authSession?.deviceMethod || '').trim().toLowerCase();
    const amr = Array.isArray(req.authSession?.amr)
        ? req.authSession.amr.map((entry) => String(entry || '').trim().toLowerCase())
        : [];
    const stepUpUntilMs = req.authSession?.stepUpUntil
        ? new Date(req.authSession.stepUpUntil).getTime()
        : 0;

    return (deviceMethod === 'webauthn' || amr.includes('webauthn'))
        && Number.isFinite(stepUpUntilMs)
        && stepUpUntilMs > Date.now();
};

const BOOTSTRAP_CHALLENGE_SCOPE_OTP_SEND_LOGIN = 'otp-send:login';
const BOOTSTRAP_CHALLENGE_SCOPE_OTP_SEND_FORGOT_PASSWORD = 'otp-send:forgot-password';
const BOOTSTRAP_CHALLENGE_SCOPE_PHONE_FACTOR_FORGOT_PASSWORD = 'phone-factor:forgot-password';
const BOOTSTRAP_CHALLENGE_SCOPE_RESET_PASSWORD = 'reset-password';
const ALLOWED_BOOTSTRAP_CHALLENGE_SCOPES = new Set([
    BOOTSTRAP_CHALLENGE_SCOPE_OTP_SEND_LOGIN,
    BOOTSTRAP_CHALLENGE_SCOPE_OTP_SEND_FORGOT_PASSWORD,
    BOOTSTRAP_CHALLENGE_SCOPE_PHONE_FACTOR_FORGOT_PASSWORD,
    BOOTSTRAP_CHALLENGE_SCOPE_RESET_PASSWORD,
]);

const normalizeBootstrapChallengeScope = (value) => {
    const normalized = String(value || '').trim().toLowerCase();
    return ALLOWED_BOOTSTRAP_CHALLENGE_SCOPES.has(normalized) ? normalized : '';
};

const resolveVerifiedAtMillis = (value) => {
    if (!value) return 0;
    const resolved = new Date(value).getTime();
    return Number.isFinite(resolved) ? resolved : 0;
};

const buildTrustedDeviceBootstrapSignal = async ({
    req,
    user,
    scope = '',
}) => {
    return resolveTrustedDeviceBootstrapSignal({
        req,
        user,
        challengePayload: extractTrustedDeviceChallengePayload(req.body || {}),
        expectedScope: scope,
        requireFreshProof: true,
    });
};

const resolveBootstrapChallengeUser = async ({
    scope = '',
    email = '',
    phone = '',
    flowToken = '',
}) => {
    if (scope === BOOTSTRAP_CHALLENGE_SCOPE_RESET_PASSWORD) {
        try {
            const inspectedFlow = inspectOtpFlowToken(flowToken);
            if (inspectedFlow.purpose !== 'forgot-password') {
                return null;
            }

            const user = await User.findById(inspectedFlow.sub, 'email phone isVerified trustedDevices').lean();
            return user?.isVerified ? user : null;
        } catch {
            return null;
        }
    }

    if (!email) {
        return null;
    }

    const user = await User.findOne(
        { email, isVerified: true },
        'email phone isVerified trustedDevices'
    ).lean();

    if (!user?.isVerified) {
        return null;
    }

    if (phone) {
        const storedPhone = canonicalizePhone(user.phone || '');
        if (storedPhone && storedPhone !== phone) {
            return null;
        }
    }

    return user;
};

const requestBootstrapDeviceChallenge = asyncHandler(async (req, res) => {
    const scope = normalizeBootstrapChallengeScope(req.body?.scope);
    if (!scope) {
        throw new AppError('Invalid trusted device bootstrap scope.', 400);
    }

    const email = normalizeEmail(req.body?.email);
    const phone = canonicalizePhone(req.body?.phone);
    const flowToken = typeof req.body?.flowToken === 'string'
        ? req.body.flowToken.trim()
        : '';
    const user = await resolveBootstrapChallengeUser({
        scope,
        email,
        phone,
        flowToken,
    });

    const deviceChallenge = user
        ? await issueTrustedDeviceBootstrapChallenge({
            req,
            user,
            scope,
        })
        : null;

    if (deviceChallenge) {
        recordAuthSecurityEvent({
            event: 'trusted_device_challenge',
            outcome: 'issued',
            reason: 'none',
            surface: 'trusted_device',
            req,
            meta: { scope },
        });
    }

    res.json({
        success: true,
        deviceChallenge: deviceChallenge || null,
    });
});

const resolveTrustedDeviceSessionToken = (req = {}) => String(
    req.get?.(TRUSTED_DEVICE_SESSION_HEADER)
    || req.headers?.[TRUSTED_DEVICE_SESSION_HEADER]
    || ''
).trim();

const hasSessionTrustedDeviceState = (req = {}, deviceId = '') => {
    const normalizedDeviceId = String(deviceId || '').trim();
    const sessionDeviceId = String(req.authSession?.deviceId || '').trim();
    const sessionDeviceMethod = String(req.authSession?.deviceMethod || '').trim().toLowerCase();
    const sessionAmr = Array.isArray(req.authSession?.amr)
        ? req.authSession.amr.map((entry) => String(entry || '').trim().toLowerCase())
        : [];

    if (!normalizedDeviceId || !sessionDeviceId || normalizedDeviceId !== sessionDeviceId) {
        return false;
    }

    if (sessionDeviceMethod === 'webauthn' || sessionDeviceMethod === 'browser_key') {
        return true;
    }

    return sessionAmr.includes('webauthn') || sessionAmr.includes('trusted_device');
};

const shouldEnforceRuntimeRiskSessionStepUp = (req = {}) => (
    String(req.authSession?.riskState || '').trim().toLowerCase() === LOGIN_RISK_STATE_HIGH
    && getLoginRuntimeEnforcementPolicy().riskEngineEnforced
);

const resolveLoginRiskInputs = ({ req = {}, user = null } = {}) => {
    const { deviceId } = extractTrustedDeviceContext(req);
    const riskSignal = extractTrustedLoginRiskSignals(req, { deviceId });
    const runtimeSignals = riskSignal.signals || {};

    return {
        user,
        deviceId,
        recentFailureCount: runtimeSignals.recentFailureCount,
        ipReputation: runtimeSignals.ipReputation,
        impossibleTravel: runtimeSignals.impossibleTravel,
        emailVerified: Boolean(user?.isVerified || req.authToken?.email_verified),
        trustedDeviceRequired: shouldRequireTrustedDevice({ user }),
        riskSignal,
    };
};

const evaluateRuntimeLoginRisk = ({ req = {}, user = null } = {}) => {
    const policy = getLoginRuntimeEnforcementPolicy();
    if (policy.riskEngineMode === 'off') {
        return {
            policy,
            risk: null,
            forceStepUp: false,
            riskState: 'standard',
            stepUpReason: '',
        };
    }

    const { riskSignal, ...riskInputs } = resolveLoginRiskInputs({ req, user });
    const risk = evaluateLoginRisk(riskInputs);
    const forceStepUp = Boolean(
        policy.riskEngineEnforced
        && risk.requireStepUp
        && risk.level === RISK_LEVELS.HIGH
    );
    const stepUpReason = risk.block ? 'login_risk_block' : 'login_risk_high';

    recordAuthSecurityEvent({
        event: 'login_risk',
        outcome: forceStepUp ? 'required' : 'success',
        reason: forceStepUp ? 'required' : 'none',
        surface: 'auth',
        req,
        level: forceStepUp ? 'warn' : 'info',
        meta: {
            mode: policy.riskEngineMode,
            enforced: policy.riskEngineEnforced,
            stepUpReason: forceStepUp ? stepUpReason : '',
            score: risk.score,
            riskLevel: risk.level,
            requireStepUp: risk.requireStepUp,
            blockRecommended: risk.block,
            reasons: risk.reasons,
            knownDevice: risk.knownDevice,
            signalSource: riskSignal.source,
            signalTrusted: riskSignal.trusted,
            ignoredUntrustedSignals: riskSignal.ignoredUntrustedHeaders,
            signalTrustReason: riskSignal.reason,
        },
    });

    return {
        policy,
        risk,
        forceStepUp,
        riskState: forceStepUp ? LOGIN_RISK_STATE_HIGH : 'standard',
        stepUpReason,
    };
};

const persistBrowserSessionForUser = async ({
    req,
    res,
    user,
    rotate = false,
    deviceMethod = '',
    stepUpUntil = null,
    additionalAmr = [],
    riskState = '',
} = {}) => {
    if (!user?._id) {
        return null;
    }

    const nextSession = await refreshBrowserSession({
        req,
        res,
        currentSession: req.authSession || null,
        user,
        authUid: req.authUid || '',
        authToken: req.authToken || null,
        deviceMethod,
        stepUpUntil,
        additionalAmr,
        riskState,
        rotate,
    });

    req.authSession = nextSession;
    const supersededSessionId = String(req.supersededAuthSessionId || '').trim();
    if (supersededSessionId && supersededSessionId !== nextSession.sessionId) {
        await revokeBrowserSession(supersededSessionId);
        req.supersededAuthSessionId = '';
    }

    return nextSession;
};

const establishSessionCookie = asyncHandler(async (req, res, next) => {
    if (req.authSession?.sessionId || !req.user?._id || !req.authToken) {
        return next();
    }

    await persistBrowserSessionForUser({
        req,
        res,
        user: req.user,
        rotate: false,
    });

    return next();
});

const resolveDeviceChallengeState = async ({
    req,
    authUser = {},
    authToken = null,
    authUid = '',
    user = null,
    forceStepUp = false,
    stepUpReason = 'trusted_device_required',
    riskDecision = null,
}) => {
    if (!forceStepUp && !shouldRequireTrustedDevice({ user })) {
        return { status: 'authenticated', deviceChallenge: null };
    }

    const { deviceId, deviceLabel } = extractTrustedDeviceContext(req);
    if (!deviceId) {
        recordAuthSecurityEvent({
            event: 'step_up_required',
            outcome: 'blocked',
            reason: forceStepUp ? 'required' : 'trusted_device_missing',
            surface: 'trusted_device',
            req,
            meta: {
                statusCode: 400,
                stepUpReason: forceStepUp ? stepUpReason : '',
                riskScore: riskDecision?.score,
                riskLevel: riskDecision?.level,
            },
        });
        throw new AppError('Trusted device identity is required for this account. Refresh and try again.', 400);
    }

    const trustedDeviceSession = verifyTrustedDeviceSession({
        user,
        authUid,
        authToken,
        deviceId,
        deviceSessionToken: resolveTrustedDeviceSessionToken(req),
    });

    if (trustedDeviceSession.success) {
        return { status: 'authenticated', deviceChallenge: null };
    }

    if (hasSessionTrustedDeviceState(req, deviceId)) {
        return { status: 'authenticated', deviceChallenge: null };
    }

    const deviceChallenge = await issueTrustedDeviceChallenge({
        req,
        user,
        authUid,
        authToken,
        deviceId,
        deviceLabel,
    });

    recordAuthSecurityEvent({
        event: 'trusted_device_challenge',
        outcome: 'required',
        reason: forceStepUp ? 'required' : 'trusted_device_required',
        surface: 'trusted_device',
        req,
        meta: {
            mode: deviceChallenge?.mode || '',
            method: deviceChallenge?.method || '',
            stepUpReason: forceStepUp ? stepUpReason : '',
            riskScore: riskDecision?.score,
            riskLevel: riskDecision?.level,
            riskReasons: riskDecision?.reasons,
        },
    });

    return {
        status: 'device_challenge_required',
        deviceChallenge,
    };
};

const buildRequestAuthUser = (req) => ({
    ...req.user,
    uid: req.authUid || req.authIdentity?.uid || '',
    email: req.authIdentity?.email || req.authToken?.email || req.user?.email || '',
    displayName: req.authIdentity?.displayName || req.authToken?.name || req.user?.name || '',
    phoneNumber: req.authIdentity?.phoneNumber || req.authToken?.phone_number || req.user?.phone || '',
    emailVerified: resolveEmailVerifiedState({
        authUser: req.authIdentity || {},
        authToken: req.authToken || null,
        authSession: req.authSession || null,
        authUid: req.authUid || '',
        user: req.user || null,
    }),
    signInProvider: req.authToken?.firebase?.sign_in_provider || '',
    providerIds: resolveProviderIds({
        authUser: req.authIdentity || {},
        authToken: req.authToken || null,
        authSession: req.authSession || null,
    }),
});

const getSession = asyncHandler(async (req, res) => {
    const resolved = await resolveAuthenticatedSession({
        authUser: buildRequestAuthUser(req),
        authToken: req.authToken || null,
        authUid: req.authUid || '',
        authSession: req.authSession || null,
    });

    const { status, deviceChallenge } = await resolveDeviceChallengeState({
        req,
        authUser: buildRequestAuthUser(req),
        authToken: req.authToken || null,
        authUid: req.authUid || '',
        user: resolved.user,
        forceStepUp: shouldEnforceRuntimeRiskSessionStepUp(req),
        stepUpReason: 'login_risk_high',
    });

    recordAuthSecurityEvent({
        event: 'session_check',
        outcome: status === 'authenticated' ? 'success' : 'required',
        reason: status === 'authenticated' ? 'none' : status,
        surface: 'auth',
        req,
        meta: { status },
    });

    res.json({
        ...resolved.payload,
        status,
        deviceChallenge,
    });
});

const startDuoLogin = asyncHandler(async (req, res) => {
    const authorizationUrl = await buildDuoAuthorizationUrl({
        req,
        res,
        returnTo: normalizeRelativeReturnTo(req.query?.returnTo || '/'),
    });

    recordAuthSecurityEvent({
        event: 'duo_oidc_login',
        outcome: 'success',
        reason: 'none',
        surface: 'auth',
        req,
        meta: { provider: 'duo_oidc' },
    });

    return res.redirect(302, authorizationUrl);
});

const completeDuoLogin = asyncHandler(async (req, res) => {
    const state = typeof req.query?.state === 'string' ? req.query.state.trim() : '';
    const code = typeof req.query?.code === 'string' ? req.query.code.trim() : '';
    const duoError = typeof req.query?.error === 'string' ? req.query.error.trim() : '';
    clearDuoStateCookie(res, req);

    if (duoError) {
        recordAuthSecurityEvent({
            event: 'duo_oidc_login',
            outcome: 'failure',
            reason: 'provider_error',
            surface: 'auth',
            req,
            meta: { statusCode: 401 },
        });
        throw new AppError('Duo login was not completed.', 401);
    }
    if (!state || !code) {
        recordAuthSecurityEvent({
            event: 'duo_oidc_login',
            outcome: 'failure',
            reason: 'missing_code_or_state',
            surface: 'auth',
            req,
            meta: { statusCode: 422 },
        });
        throw new AppError('Duo login callback is missing required parameters.', 422);
    }

    const statePayload = consumeDuoState({ req, state });
    const claims = await exchangeDuoCodeForClaims({ code, statePayload });
    const email = normalizeEmail(claims.email);
    const authUid = `duo:${claims.sub}`;
    const authTime = Number(claims.auth_time || claims.iat || Math.floor(Date.now() / 1000));
    const authUser = {
        uid: authUid,
        email,
        name: claims.name || claims.preferred_username || email.split('@')[0],
        displayName: claims.name || claims.preferred_username || email.split('@')[0],
        emailVerified: true,
        providerIds: ['duo_oidc'],
        signInProvider: 'duo_oidc',
    };
    const authToken = {
        uid: authUid,
        email,
        name: authUser.name,
        email_verified: true,
        auth_time: authTime,
        iat: Number(claims.iat || authTime),
        exp: Number(claims.exp || (authTime + 3600)),
        firebase: {
            sign_in_provider: 'duo_oidc',
            sign_in_second_factor: 'duo',
        },
    };

    const user = await syncAuthenticatedUser({
        authUser,
        email,
        name: authUser.name,
        awardLoginPoints: true,
    });

    await invalidateUserCache(authUid);
    await invalidateUserCacheByEmail(email);
    const authSession = await refreshBrowserSession({
        req,
        res,
        user,
        authUid,
        authToken,
        rotate: false,
        additionalAmr: ['duo', 'duo_oidc'],
        riskState: user?.isAdmin ? 'privileged' : user?.isSeller ? 'heightened' : 'standard',
    });
    req.authSession = authSession;

    recordAuthSecurityEvent({
        event: 'duo_oidc_login',
        outcome: 'success',
        reason: 'none',
        surface: 'auth',
        req,
        meta: { provider: 'duo_oidc' },
    });

    return res.redirect(302, buildDuoFrontendRedirect({
        returnTo: statePayload.returnTo || '/',
        status: 'success',
    }));
});

const syncSession = asyncHandler(async (req, res) => {
    const authUser = buildRequestAuthUser(req);
    const flowToken = typeof req.body?.flowToken === 'string'
        ? req.body.flowToken.trim()
        : '';
    const { deviceId } = extractTrustedDeviceContext(req);
    const deviceSessionHash = hashTrustedDeviceSessionToken(getTrustedDeviceSessionToken(req));
    const requestedEmail = normalizeEmail(req.body?.email || authUser.email || req.authToken?.email || '');
    const authUid = req.authUid || req.authToken?.uid || '';

    if (await isEmergencyFlagEnabled('DISABLE_SIGNUP', { failClosed: false })) {
        const identityClauses = [
            ...(requestedEmail ? [{ email: requestedEmail }] : []),
            ...(authUid ? [{ authUid }] : []),
        ];
        const existingUserQuery = identityClauses.length > 0
            ? User.findOne({ $or: identityClauses }, '_id')
            : null;
        const existingUser = existingUserQuery && typeof existingUserQuery.lean === 'function'
            ? await existingUserQuery.lean()
            : await existingUserQuery;

        if (!existingUser) {
            const error = new AppError('Signup is temporarily unavailable. Please try again later.', 503);
            error.code = 'FEATURE_TEMPORARILY_DISABLED';
            error.feature = 'signup';
            throw error;
        }
    }

    let user = await syncAuthenticatedUser({
        authUser,
        email: req.body?.email,
        name: req.body?.name,
        phone: req.body?.phone,
        awardLoginPoints: true,
    });

    if (flowToken) {
        user = await applyLoginAssuranceToSession({
            user,
            flowToken,
            authToken: req.authToken || null,
            authUid: req.authUid || req.authToken?.uid || '',
            deviceId,
            deviceSessionHash,
            phone: req.body?.phone,
        });
    }

    await invalidateUserCache(req.authUid || '');
    await invalidateUserCacheByEmail(user?.email || authUser.email || '');

    const loginRisk = evaluateRuntimeLoginRisk({ req, user });

    const { status, deviceChallenge } = await resolveDeviceChallengeState({
        req,
        authUser,
        authToken: req.authToken || null,
        authUid: req.authUid || '',
        user,
        forceStepUp: loginRisk.forceStepUp,
        stepUpReason: loginRisk.stepUpReason || 'login_risk_high',
        riskDecision: loginRisk.risk,
    });

    await persistBrowserSessionForUser({
        req,
        res,
        user,
        rotate: Boolean(req.authSession?.sessionId),
        stepUpUntil: user?.loginOtpAssuranceExpiresAt || null,
        additionalAmr: String(user?.authAssurance || '').trim() === 'password+otp' ? ['otp'] : [],
        riskState: loginRisk.riskState,
    });

    recordAuthSecurityEvent({
        event: 'login_session',
        outcome: status === 'authenticated' ? 'success' : 'required',
        reason: status === 'authenticated' ? 'none' : status,
        surface: 'auth',
        req,
        meta: { status },
    });

    res.json(buildSessionPayload({
        authUser,
        authToken: req.authToken || null,
        authUid: req.authUid || '',
        authSession: req.authSession || null,
        user,
        status,
        deviceChallenge,
    }));
});

const completePhoneFactorLogin = asyncHandler(async (req, res) => {
    const authUser = buildRequestAuthUser(req);
    const tokenEmail = normalizeEmail(req.authToken?.email || authUser.email);
    const requestEmail = normalizeEmail(req.body?.email);
    const requestPhone = canonicalizePhone(req.body?.phone);
    const verifiedTokenPhone = canonicalizePhone(req.authToken?.phone_number || authUser.phoneNumber);

    if (!requestEmail) {
        throw new AppError('Email is required', 400);
    }
    if (!requestPhone) {
        throw new AppError('Valid phone number is required', 400);
    }
    if (!tokenEmail || tokenEmail !== requestEmail) {
        throw new AppError('Email in request does not match authenticated account', 400);
    }
    if (!verifiedTokenPhone) {
        throw new AppError('Firebase phone verification is required before completing login.', 403);
    }
    if (verifiedTokenPhone !== requestPhone) {
        throw new AppError('Verified phone number does not match the requested login phone.', 403);
    }

    const existingUser = await User.findOne(
        { email: tokenEmail },
        'name email phone avatar gender dob bio isAdmin adminRoles isVerified isSeller sellerActivatedAt accountState moderation loyalty createdAt'
    )
        .select('+loginEmailOtpVerifiedAt')
        .lean();

    if (!existingUser) {
        throw new AppError('User profile missing from login database. Please sign in again to recover your account.', 404);
    }

    const emailOtpVerifiedAt = existingUser.loginEmailOtpVerifiedAt
        ? new Date(existingUser.loginEmailOtpVerifiedAt).getTime()
        : 0;
    const emailOtpStillFresh = Number.isFinite(emailOtpVerifiedAt)
        && emailOtpVerifiedAt > 0
        && (Date.now() - emailOtpVerifiedAt) <= LOGIN_ASSURANCE_TTL_MS;

    if (!emailOtpStillFresh) {
        if (emailOtpVerifiedAt > 0) {
            await User.updateOne(
                { email: tokenEmail },
                { $set: { loginEmailOtpVerifiedAt: null } }
            );
        }
        throw new AppError(
            emailOtpVerifiedAt > 0
                ? 'Email OTP verification expired. Please restart secure sign-in.'
                : 'Email OTP verification is required before completing phone factor login.',
            403
        );
    }

    const storedPhone = canonicalizePhone(existingUser.phone || '');
    if (storedPhone && storedPhone !== requestPhone) {
        throw new AppError('Phone number does not match your registered account.', 403);
    }

    const updatedUser = await User.findOneAndUpdate(
        { email: tokenEmail },
        {
            $set: {
                phone: storedPhone || requestPhone,
                isVerified: Boolean(existingUser.isVerified || req.authToken?.email_verified),
                authAssurance: 'password+otp',
                authAssuranceAt: new Date(),
                authAssuranceAuthTime: Number(req.authToken?.auth_time || 0) || null,
                loginEmailOtpVerifiedAt: null,
                loginOtpVerifiedAt: new Date(),
                loginOtpAssuranceExpiresAt: new Date(Date.now() + LOGIN_ASSURANCE_TTL_MS),
            },
        },
        {
            returnDocument: 'after',
            projection: 'name email phone avatar gender dob bio isAdmin adminRoles isVerified isSeller sellerActivatedAt accountState moderation loyalty createdAt',
            lean: true,
        }
    );

    await persistAuthSnapshot(updatedUser);
    await invalidateUserCache(req.authUid || '');
    await invalidateUserCacheByEmail(tokenEmail);

    await persistBrowserSessionForUser({
        req,
        res,
        user: updatedUser,
        rotate: Boolean(req.authSession?.sessionId),
        stepUpUntil: updatedUser?.loginOtpAssuranceExpiresAt || null,
        additionalAmr: ['otp'],
    });

    recordAuthSecurityEvent({
        event: 'login_session',
        outcome: 'success',
        reason: 'none',
        surface: 'auth',
        req,
        meta: { factor: 'phone' },
    });

    res.json(buildSessionPayload({
        authUser: {
            ...authUser,
            email: tokenEmail,
            phoneNumber: requestPhone,
            phone: requestPhone,
        },
        authToken: req.authToken || null,
        authUid: req.authUid || '',
        authSession: req.authSession || null,
        user: updatedUser,
    }));
});

const completePhoneFactorVerification = asyncHandler(async (req, res) => {
    const purpose = normalizePhoneFactorPurpose(req.body?.purpose);
    const requestEmail = normalizeEmail(req.body?.email);
    const requestPhone = canonicalizePhone(req.body?.phone);
    const verifiedTokenPhone = canonicalizePhone(req.authToken?.phone_number || '');

    if (!purpose) {
        throw new AppError('Invalid phone factor purpose. Must be signup or forgot-password.', 400);
    }
    if (!requestEmail) {
        throw new AppError('Email is required', 400);
    }
    if (!requestPhone) {
        throw new AppError('Valid phone number is required', 400);
    }
    if (!verifiedTokenPhone) {
        throw new AppError('Firebase phone verification is required before continuing.', 403);
    }
    if (verifiedTokenPhone !== requestPhone) {
        throw new AppError('Verified phone number does not match the requested phone.', 403);
    }

    if (purpose === 'signup') {
        const pendingUser = await User.findOne(
            { email: requestEmail },
            'name email phone avatar gender dob bio isAdmin adminRoles isVerified'
        )
            .select('+signupEmailOtpVerifiedAt')
            .lean();

        if (!pendingUser) {
            throw phoneFactorFlowError();
        }
        if (pendingUser.isVerified) {
            throw phoneFactorFlowError();
        }

        const emailOtpVerifiedAt = resolveVerifiedAtMillis(pendingUser.signupEmailOtpVerifiedAt);
        const emailOtpStillFresh = emailOtpVerifiedAt > 0
            && (Date.now() - emailOtpVerifiedAt) <= PHONE_FACTOR_ASSURANCE_TTL_MS;

        if (!emailOtpStillFresh) {
            if (emailOtpVerifiedAt > 0) {
                await User.updateOne(
                    { email: requestEmail, isVerified: false },
                    { $set: { signupEmailOtpVerifiedAt: null } }
                );
            }
            throw phoneFactorFlowError();
        }

        const storedPhone = canonicalizePhone(pendingUser.phone || '');
        if (storedPhone && storedPhone !== requestPhone) {
            throw phoneFactorFlowError();
        }

        const updatedUser = await User.findOneAndUpdate(
            { email: requestEmail, isVerified: false },
            {
                $set: {
                phone: storedPhone || requestPhone,
                isVerified: true,
                authAssurance: 'otp',
                authAssuranceAt: new Date(),
                authAssuranceAuthTime: null,
                signupEmailOtpVerifiedAt: null,
            },
            },
            {
                returnDocument: 'after',
                projection: 'name email phone avatar gender dob bio isAdmin adminRoles isVerified isSeller sellerActivatedAt accountState moderation loyalty createdAt',
                lean: true,
            }
        );

        if (!updatedUser) {
            throw phoneFactorFlowError();
        }

        await persistAuthSnapshot(updatedUser);
        await invalidateUserCacheByEmail(requestEmail);

        return res.json({
            success: true,
            message: 'Firebase phone verification completed for signup.',
            purpose,
            phone: updatedUser.phone,
        });
    }

    const existingUser = await User.findOne(
        { email: requestEmail, isVerified: true },
        'name email phone avatar gender dob bio isAdmin adminRoles isVerified trustedDevices isSeller sellerActivatedAt accountState moderation loyalty createdAt'
    )
        .select('+resetEmailOtpVerifiedAt')
        .lean();

    if (!existingUser) {
        throw phoneFactorFlowError();
    }

    const emailOtpVerifiedAt = resolveVerifiedAtMillis(existingUser.resetEmailOtpVerifiedAt);
    const emailOtpStillFresh = emailOtpVerifiedAt > 0
        && (Date.now() - emailOtpVerifiedAt) <= PHONE_FACTOR_ASSURANCE_TTL_MS;

    if (!emailOtpStillFresh) {
        if (emailOtpVerifiedAt > 0) {
            await User.updateOne(
                { email: requestEmail, isVerified: true },
                { $set: { resetEmailOtpVerifiedAt: null } }
            );
        }
        throw phoneFactorFlowError();
    }

    const storedPhone = canonicalizePhone(existingUser.phone || '');
    if (storedPhone && storedPhone !== requestPhone) {
        throw phoneFactorFlowError();
    }

    const updatedUser = await User.findOneAndUpdate(
        { email: requestEmail, isVerified: true },
        {
            $set: {
                phone: storedPhone || requestPhone,
                authAssurance: 'otp',
                authAssuranceAt: new Date(),
                authAssuranceAuthTime: null,
                resetEmailOtpVerifiedAt: null,
                resetOtpVerifiedAt: new Date(),
            },
        },
        {
            returnDocument: 'after',
            projection: 'name email phone avatar gender dob bio isAdmin adminRoles isVerified trustedDevices isSeller sellerActivatedAt accountState moderation loyalty createdAt',
            lean: true,
        }
    );

    if (!updatedUser) {
        throw phoneFactorFlowError();
    }

    await persistAuthSnapshot(updatedUser);
    await invalidateUserCacheByEmail(requestEmail);
    const verifiedBootstrapDeviceSignal = await buildTrustedDeviceBootstrapSignal({
        req,
        user: updatedUser,
        scope: BOOTSTRAP_CHALLENGE_SCOPE_PHONE_FACTOR_FORGOT_PASSWORD,
    });
    if (verifiedBootstrapDeviceSignal.required && !verifiedBootstrapDeviceSignal.verified) {
        throw new AppError(verifiedBootstrapDeviceSignal.reason || 'Fresh trusted device verification is required.', 403);
    }
    const { tokenState, ...publicFlowPayload } = issueOtpFlowToken({
        userId: updatedUser._id,
        purpose,
        factor: 'otp',
        signalBond: {
            ...(verifiedBootstrapDeviceSignal.deviceId ? { deviceId: verifiedBootstrapDeviceSignal.deviceId } : {}),
            ...(verifiedBootstrapDeviceSignal.deviceSessionHash
                ? { deviceSessionHash: verifiedBootstrapDeviceSignal.deviceSessionHash }
                : {}),
        },
    });
    await registerOtpFlowGrant({
        tokenId: tokenState?.tokenId,
        userId: updatedUser._id,
        purpose,
        factor: 'otp',
        currentStep: 'phone-factor-verified',
        nextStep: tokenState?.nextStep,
        expiresAt: publicFlowPayload.flowTokenExpiresAt,
    });

    return res.json({
        success: true,
        message: 'Firebase phone verification completed for password recovery.',
        purpose,
        phone: updatedUser.phone,
        ...publicFlowPayload,
    });
});

const generateBackupRecoveryCodes = asyncHandler(async (req, res) => {
    const user = await User.findById(req.user?._id, 'trustedDevices recoveryCodeState').lean();
    if (!user?._id) {
        throw new AppError('User not found', 404);
    }
    if (getPasskeyCount(user) <= 0) {
        throw new AppError('Register a passkey before creating backup recovery codes.', 409);
    }
    if (!hasFreshPasskeySession(req)) {
        throw new AppError('Fresh passkey verification is required before creating backup recovery codes.', 403);
    }

    const result = await generateRecoveryCodesForUser({ userId: user._id });
    await invalidateUserCache(req.authUid || '');
    await invalidateUserCacheByEmail(req.user?.email || '');

    recordAuthSecurityEvent({
        event: 'recovery_code',
        outcome: 'issued',
        reason: 'none',
        surface: 'recovery',
        req,
        meta: { activeCount: result.recoveryCodeState?.activeCount || 0 },
    });

    res.status(201).json({
        success: true,
        message: 'Backup recovery codes generated. Store them somewhere safe; they will not be shown again.',
        recoveryCodes: result.codes,
        recoveryCodeState: result.recoveryCodeState,
        recoveryReadiness: result.readiness,
    });
});

const verifyBackupRecoveryCode = asyncHandler(async (req, res) => {
    const email = normalizeEmail(req.body?.email);
    const code = String(req.body?.code || '').trim();
    const { deviceId } = extractTrustedDeviceContext(req);
    const deviceSessionToken = getTrustedDeviceSessionToken(req);
    const responseStartedAt = Date.now();

    if (!email || !code) {
        throw new AppError('Email and recovery code are required.', 400);
    }

    let recoveryResult = null;
    try {
        recoveryResult = await consumeRecoveryCodeForPasswordReset({
            email,
            code,
        });
    } catch (error) {
        await waitForRecoveryCodeVerificationWindow(responseStartedAt);
        recordAuthSecurityEvent({
            event: 'recovery_code',
            outcome: 'failure',
            reason: error?.message || 'invalid',
            surface: 'recovery',
            req,
            meta: { statusCode: error?.statusCode || 401 },
        });
        throw error;
    }

    const { user, recoveryCodeState } = recoveryResult;
    const { tokenState, ...publicFlowPayload } = issueOtpFlowToken({
        userId: user._id,
        purpose: 'forgot-password',
        factor: 'recovery-code',
        nextStep: 'reset-password',
        signalBond: {
            ...(deviceId ? { deviceId } : {}),
            ...(deviceId && deviceSessionToken
                ? { deviceSessionHash: hashTrustedDeviceSessionToken(deviceSessionToken) }
                : {}),
        },
    });
    await registerOtpFlowGrant({
        tokenId: tokenState?.tokenId,
        userId: user._id,
        purpose: 'forgot-password',
        factor: 'recovery-code',
        currentStep: 'recovery-code-verified',
        nextStep: tokenState?.nextStep,
        expiresAt: publicFlowPayload.flowTokenExpiresAt,
    });

    await invalidateUserCacheByEmail(user.email || email);

    recordAuthSecurityEvent({
        event: 'recovery_code',
        outcome: 'success',
        reason: 'none',
        surface: 'recovery',
        req,
        meta: { activeCount: recoveryCodeState?.activeCount || 0 },
    });

    res.json({
        success: true,
        message: 'Recovery code verified. You can now set a new password.',
        ...publicFlowPayload,
        recoveryCodeState,
    });
});

// @desc    Verify trusted device proof
// @route   POST /api/auth/verify-device
// @access  Private
const verifyDeviceChallenge = asyncHandler(async (req, res) => {
    const {
        token,
        method,
        proof,
        publicKeySpkiBase64,
        credential,
    } = req.body;
    if (!token || (!proof && !credential)) {
        throw new AppError('Trusted device token and proof or passkey credential are required', 400);
    }

    const { deviceId, deviceLabel } = extractTrustedDeviceContext(req);
    if (!deviceId) {
        throw new AppError('Trusted device identity is missing', 400);
    }

    const verification = await verifyTrustedDeviceChallenge({
        user: req.user,
        authUid: req.authUid || '',
        authToken: req.authToken || null,
        token,
        method,
        proof,
        deviceId,
        deviceLabel,
        publicKeySpkiBase64,
        credential,
    });

    if (!verification.success) {
        recordAuthSecurityEvent({
            event: 'trusted_device_verify',
            outcome: 'failure',
            reason: verification.reason || 'invalid',
            surface: 'trusted_device',
            req,
            meta: { statusCode: 403 },
        });
        throw new AppError(`Trusted device verification failed: ${verification.reason}`, 403);
    }

    await invalidateUserCache(req.authUid || '');
    await invalidateUserCacheByEmail(req.user?.email || '');

    await persistBrowserSessionForUser({
        req,
        res,
        user: req.user,
        rotate: Boolean(req.authSession?.sessionId),
        deviceMethod: verification.method === 'webauthn' ? 'webauthn' : 'browser_key',
        stepUpUntil: verification.expiresAt || null,
        additionalAmr: [verification.method === 'webauthn' ? 'webauthn' : 'trusted_device'],
    });

    const sessionPayload = buildSessionPayload({
        authUser: buildRequestAuthUser(req),
        authToken: req.authToken || null,
        authUid: req.authUid || '',
        authSession: req.authSession || null,
        user: req.user,
        status: 'authenticated',
        deviceChallenge: null,
    });

    recordAuthSecurityEvent({
        event: 'trusted_device_verify',
        outcome: 'success',
        reason: 'none',
        surface: 'trusted_device',
        req,
        meta: { mode: verification.mode || '', method: verification.method || '' },
    });

    res.json({
        success: true,
        message: verification.mode === 'enroll'
            ? 'Trusted device registered and verified'
            : 'Trusted device verified',
        ...sessionPayload,
        ...verification,
        status: 'authenticated',
        deviceChallenge: null,
    });
});

const logoutSession = asyncHandler(async (req, res) => {
    const existingSession = req.authSession?.sessionId
        ? req.authSession
        : await getBrowserSessionFromRequest(req);

    if (existingSession?.sessionId) {
        await revokeBrowserSession(existingSession.sessionId);
    }
    clearBrowserSessionCookie(res, req);
    res.json({
        success: true,
        status: 'signed_out',
    });
});

module.exports = {
    completeDuoLogin,
    establishSessionCookie,
    generateBackupRecoveryCodes,
    getSession,
    requestBootstrapDeviceChallenge,
    startDuoLogin,
    verifyBackupRecoveryCode,
    syncSession,
    logoutSession,
    completePhoneFactorLogin,
    completePhoneFactorVerification,
    verifyDeviceChallenge,
};

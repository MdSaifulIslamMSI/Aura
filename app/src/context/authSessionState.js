export const SESSION_STATUS = {
    BOOTSTRAP: 'bootstrap',
    LOADING: 'loading',
    AUTHENTICATED: 'authenticated',
    DEVICE_CHALLENGE: 'device_challenge_required',
    MFA_CHALLENGE: 'mfa_challenge_required',
    RECOVERABLE_ERROR: 'recoverable_error',
    SIGNED_OUT: 'signed_out',
};

const LEGACY_SESSION_STATUS = {
    LATTICE_CHALLENGE: 'lattice_challenge_required',
};

export const VALID_TRANSITIONS = {
    [SESSION_STATUS.BOOTSTRAP]: [SESSION_STATUS.LOADING, SESSION_STATUS.SIGNED_OUT, SESSION_STATUS.RECOVERABLE_ERROR, SESSION_STATUS.AUTHENTICATED, SESSION_STATUS.DEVICE_CHALLENGE, SESSION_STATUS.MFA_CHALLENGE],
    [SESSION_STATUS.LOADING]: [SESSION_STATUS.AUTHENTICATED, SESSION_STATUS.SIGNED_OUT, SESSION_STATUS.RECOVERABLE_ERROR, SESSION_STATUS.DEVICE_CHALLENGE, SESSION_STATUS.MFA_CHALLENGE],
    [SESSION_STATUS.AUTHENTICATED]: [SESSION_STATUS.SIGNED_OUT, SESSION_STATUS.LOADING, SESSION_STATUS.DEVICE_CHALLENGE, SESSION_STATUS.MFA_CHALLENGE],
    [SESSION_STATUS.DEVICE_CHALLENGE]: [SESSION_STATUS.AUTHENTICATED, SESSION_STATUS.SIGNED_OUT, SESSION_STATUS.LOADING, SESSION_STATUS.MFA_CHALLENGE],
    [SESSION_STATUS.MFA_CHALLENGE]: [SESSION_STATUS.AUTHENTICATED, SESSION_STATUS.SIGNED_OUT, SESSION_STATUS.LOADING, SESSION_STATUS.DEVICE_CHALLENGE],
    [SESSION_STATUS.RECOVERABLE_ERROR]: [SESSION_STATUS.LOADING, SESSION_STATUS.SIGNED_OUT, SESSION_STATUS.AUTHENTICATED],
    [SESSION_STATUS.SIGNED_OUT]: [SESSION_STATUS.LOADING, SESSION_STATUS.BOOTSTRAP],
};

export const EMPTY_ROLES = {
    isAdmin: false,
    adminRoles: [],
    isSeller: false,
    isVerified: false,
};

export const EMPTY_SESSION_STATE = {
    status: SESSION_STATUS.BOOTSTRAP,
    deviceChallenge: null,
    mfaChallenge: null,
    mfaPolicy: null,
    session: null,
    intelligence: null,
    profile: null,
    roles: EMPTY_ROLES,
    error: null,
};

export const normalizeText = (value) => (typeof value === 'string' ? value.trim() : '');
export const normalizeEmail = (value) => (typeof value === 'string' ? value.trim().toLowerCase() : '');
export const normalizePhone = (value) => (
    typeof value === 'string' ? value.trim().replace(/[\s\-()]/g, '') : ''
);

const parseTimeMillis = (value) => {
    if (!value) return 0;
    const parsed = new Date(value).getTime();
    return Number.isFinite(parsed) ? parsed : 0;
};

export const normalizeSessionStatus = (value) => {
    const normalized = normalizeText(value);
    if (normalized === LEGACY_SESSION_STATUS.LATTICE_CHALLENGE) {
        return SESSION_STATUS.DEVICE_CHALLENGE;
    }

    return Object.values(SESSION_STATUS).includes(normalized)
        ? normalized
        : SESSION_STATUS.SIGNED_OUT;
};

export const isAuthenticatedSessionStatus = (value) => (
    normalizeSessionStatus(value) === SESSION_STATUS.AUTHENTICATED
);

export const buildRoleState = (profile = null, fallbackVerified = false) => ({
    isAdmin: Boolean(
        profile?.isAdmin
        || (Array.isArray(profile?.adminRoles) && profile.adminRoles.some((entry) => normalizeText(entry)))
    ),
    adminRoles: Array.isArray(profile?.adminRoles) ? profile.adminRoles : [],
    isSeller: Boolean(profile?.isSeller),
    isVerified: Boolean(profile?.isVerified ?? fallbackVerified),
});

export const buildFirebaseSessionFallback = (firebaseUser = null) => {
    if (!firebaseUser) return null;

    const providerIds = Array.isArray(firebaseUser.providerData)
        ? firebaseUser.providerData.map((entry) => normalizeText(entry?.providerId)).filter(Boolean)
        : [];

    return {
        uid: normalizeText(firebaseUser.uid),
        email: normalizeEmail(firebaseUser.email),
        emailVerified: Boolean(firebaseUser.emailVerified),
        displayName: normalizeText(firebaseUser.displayName),
        phone: normalizePhone(firebaseUser.phoneNumber),
        providerIds,
        authTime: null,
        issuedAt: null,
        expiresAt: null,
    };
};

export const buildSessionIntelligenceFallback = (session = null, profile = null, roles = EMPTY_ROLES) => {
    const providerIds = Array.isArray(session?.providerIds) ? session.providerIds : [];
    const assuranceLevel = roles?.isVerified ? 'password' : 'none';
    const authTimeMs = parseTimeMillis(session?.authTime);
    const stepUpUntilMs = parseTimeMillis(session?.stepUpUntil);
    const stepUpActive = stepUpUntilMs > Date.now();
    const authAgeSeconds = authTimeMs > 0
        ? Math.max(Math.floor((Date.now() - authTimeMs) / 1000), 0)
        : null;
    const freshForSensitiveActions = Boolean(
        stepUpActive
        || (authAgeSeconds !== null && authAgeSeconds <= (15 * 60))
    );
    const recoveryCodesActiveCount = Number(profile?.recoveryCodeState?.activeCount || 0);
    const hasPasskey = Boolean(profile?.passkeyState?.hasCredentials);
    const mfaMethods = profile?.mfa?.methods || {};
    const hasTotp = Boolean(mfaMethods?.totp?.enabled || profile?.mfa?.totp?.enabled);
    const hasMfaPasskey = Boolean(mfaMethods?.passkey?.enabled || hasPasskey);
    const mfaRecoveryCodesActiveCount = Number(
        mfaMethods?.recoveryCodes?.activeCount
        ?? profile?.mfa?.methods?.recoveryCodes?.activeCount
        ?? recoveryCodesActiveCount
    );

    return {
        assurance: {
            level: assuranceLevel,
            label: roles?.isVerified ? 'Verified session' : 'Standard session',
            verifiedAt: session?.authTime || null,
            expiresAt: session?.expiresAt || null,
            isRecent: Boolean(session?.authTime),
        },
        readiness: {
            hasVerifiedEmail: Boolean(session?.emailVerified || roles?.isVerified),
            hasPhone: Boolean(profile?.phone || session?.phone),
            accountState: profile?.accountState || 'active',
            isPrivileged: Boolean(roles?.isAdmin || roles?.isSeller),
            hasPasskey,
            hasTotp,
            hasMfaPasskey,
            mfaEnabled: Boolean(profile?.mfa?.enabled || hasTotp || hasMfaPasskey),
            recoveryCodesActiveCount: mfaRecoveryCodesActiveCount,
            passkeyRecoveryReady: !hasPasskey || mfaRecoveryCodesActiveCount > 0,
            shouldEnrollRecoveryCodes: hasPasskey && mfaRecoveryCodesActiveCount <= 0,
        },
        acceleration: {
            suggestedRoute: providerIds.some((providerId) => /google|facebook|github|twitter|x\.com/i.test(providerId))
                ? 'social'
                : 'password',
            rememberedIdentifier: Boolean(profile?.phone || session?.phone) ? 'email+phone' : 'email',
            suggestedProvider: providerIds[0] || '',
            providerIds,
        },
        posture: {
            continuousAccess: Boolean(session?.sessionId || session?.uid),
            trustedDeviceBound: ['browser_key', 'webauthn'].includes(normalizeText(session?.deviceMethod)),
            cryptoDeviceBound: ['browser_key', 'webauthn'].includes(normalizeText(session?.deviceMethod)),
            device: {
                id: normalizeText(session?.deviceId),
                method: normalizeText(session?.deviceMethod) || 'none',
            },
            session: {
                cookieBound: Boolean(session?.sessionId),
                riskState: normalizeText(session?.riskState) || 'standard',
                aal: normalizeText(session?.aal) || 'aal1',
                authAgeSeconds,
                freshForSensitiveActions,
                stepUpActive,
                stepUpUntil: session?.stepUpUntil || null,
            },
            policy: {
                privilegedAccount: Boolean(roles?.isAdmin || roles?.isSeller),
                elevatedAssurance: assuranceLevel === 'password+otp' || normalizeText(session?.aal) === 'aal2',
                sensitiveActionsAllowed: Boolean(
                    freshForSensitiveActions
                    && ['browser_key', 'webauthn'].includes(normalizeText(session?.deviceMethod))
                    && (!(roles?.isAdmin || roles?.isSeller) || assuranceLevel === 'password+otp' || normalizeText(session?.aal) === 'aal2')
                ),
                reauthRecommended: false,
            },
        },
    };
};

export const buildSessionStateFromPayload = (payload = {}, firebaseUser = null) => {
    const session = payload?.session || buildFirebaseSessionFallback(firebaseUser);
    const profile = payload?.profile || null;
    const roles = payload?.roles || buildRoleState(profile, session?.emailVerified);

    return {
        status: normalizeSessionStatus(payload?.status || (session ? SESSION_STATUS.AUTHENTICATED : SESSION_STATUS.SIGNED_OUT)),
        deviceChallenge: payload?.deviceChallenge || payload?.latticeChallenge || null,
        mfaChallenge: payload?.mfaChallenge || null,
        mfaPolicy: payload?.mfaPolicy || payload?.policy || null,
        session,
        intelligence: payload?.intelligence || buildSessionIntelligenceFallback(session, profile, roles),
        profile,
        roles,
        error: payload?.error || null,
    };
};

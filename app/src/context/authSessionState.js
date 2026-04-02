export const SESSION_STATUS = {
    BOOTSTRAP: 'bootstrap',
    LOADING: 'loading',
    AUTHENTICATED: 'authenticated',
    DEVICE_CHALLENGE: 'device_challenge_required',
    RECOVERABLE_ERROR: 'recoverable_error',
    SIGNED_OUT: 'signed_out',
};

const LEGACY_SESSION_STATUS = {
    LATTICE_CHALLENGE: 'lattice_challenge_required',
};

export const VALID_TRANSITIONS = {
    [SESSION_STATUS.BOOTSTRAP]: [SESSION_STATUS.LOADING, SESSION_STATUS.SIGNED_OUT, SESSION_STATUS.RECOVERABLE_ERROR],
    [SESSION_STATUS.LOADING]: [SESSION_STATUS.AUTHENTICATED, SESSION_STATUS.SIGNED_OUT, SESSION_STATUS.RECOVERABLE_ERROR, SESSION_STATUS.DEVICE_CHALLENGE],
    [SESSION_STATUS.AUTHENTICATED]: [SESSION_STATUS.SIGNED_OUT, SESSION_STATUS.LOADING, SESSION_STATUS.DEVICE_CHALLENGE],
    [SESSION_STATUS.DEVICE_CHALLENGE]: [SESSION_STATUS.AUTHENTICATED, SESSION_STATUS.SIGNED_OUT, SESSION_STATUS.LOADING],
    [SESSION_STATUS.RECOVERABLE_ERROR]: [SESSION_STATUS.LOADING, SESSION_STATUS.SIGNED_OUT, SESSION_STATUS.AUTHENTICATED],
    [SESSION_STATUS.SIGNED_OUT]: [SESSION_STATUS.LOADING, SESSION_STATUS.BOOTSTRAP],
};

export const EMPTY_ROLES = {
    isAdmin: false,
    isSeller: false,
    isVerified: false,
};

export const EMPTY_SESSION_STATE = {
    status: SESSION_STATUS.BOOTSTRAP,
    deviceChallenge: null,
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
    isAdmin: Boolean(profile?.isAdmin),
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
        },
        acceleration: {
            suggestedRoute: providerIds.some((providerId) => /google|facebook|twitter|x\.com/i.test(providerId))
                ? 'social'
                : 'password',
            rememberedIdentifier: Boolean(profile?.phone || session?.phone) ? 'email+phone' : 'email',
            suggestedProvider: providerIds[0] || '',
            providerIds,
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
        session,
        intelligence: payload?.intelligence || buildSessionIntelligenceFallback(session, profile, roles),
        profile,
        roles,
        error: payload?.error || null,
    };
};

const INTERNAL_AUTH_EMAIL_DOMAIN = 'auth.aura.invalid';
const TRUSTED_SOCIAL_PROVIDER_REGEX = /google|facebook|twitter|x\.com|github|apple/i;

const normalizeEmail = (value) => (
    typeof value === 'string' ? value.trim().toLowerCase() : ''
);

const normalizeUid = (value) => (
    typeof value === 'string' ? value.trim() : ''
);

const normalizeText = (value) => (
    typeof value === 'string' ? value.trim() : ''
);

const encodeUidForEmail = (uid) => {
    const safeUid = normalizeUid(uid);
    if (!safeUid) return '';
    return Buffer.from(safeUid, 'utf8').toString('base64url');
};

const buildInternalAuthEmail = (uid) => {
    const encodedUid = encodeUidForEmail(uid);
    return encodedUid ? `${encodedUid}@${INTERNAL_AUTH_EMAIL_DOMAIN}` : '';
};

const isInternalAuthEmail = (value) => {
    const email = normalizeEmail(value);
    return Boolean(email) && email.endsWith(`@${INTERNAL_AUTH_EMAIL_DOMAIN}`);
};

const resolvePublicEmail = (value) => (
    isInternalAuthEmail(value) ? '' : normalizeEmail(value)
);

const resolveProviderIds = ({
    authUser = {},
    authToken = null,
    authSession = null,
} = {}) => {
    const providerIds = [];

    const appendProviderId = (value) => {
        const normalized = normalizeText(value);
        if (normalized && !providerIds.includes(normalized)) {
            providerIds.push(normalized);
        }
    };

    if (Array.isArray(authSession?.providerIds)) {
        authSession.providerIds.forEach(appendProviderId);
    }

    if (Array.isArray(authUser?.providerIds)) {
        authUser.providerIds.forEach(appendProviderId);
    } else if (Array.isArray(authUser?.providerData)) {
        authUser.providerData.forEach((entry) => appendProviderId(entry?.providerId));
    }

    appendProviderId(authSession?.signInProvider);
    appendProviderId(authUser?.signInProvider);
    appendProviderId(authToken?.firebase?.sign_in_provider);

    return providerIds;
};

const isTrustedSocialProvider = (providerId = '') => (
    TRUSTED_SOCIAL_PROVIDER_REGEX.test(normalizeText(providerId))
);

const shouldTrustProviderVerification = ({
    authUser = {},
    authToken = null,
    authSession = null,
    authUid = '',
    user = null,
} = {}) => {
    const safeUid = normalizeUid(
        authUid
        || authSession?.firebaseUid
        || authUser?.uid
        || authUser?.authUid
        || user?.authUid
    );
    const safeEmail = normalizeEmail(
        authSession?.email
        || authToken?.email
        || authUser?.email
        || user?.email
    );

    if (!safeUid && !safeEmail) {
        return false;
    }

    return resolveProviderIds({ authUser, authToken, authSession }).some(isTrustedSocialProvider);
};

const resolveEmailVerifiedState = ({
    authUser = {},
    authToken = null,
    authSession = null,
    authUid = '',
    user = null,
    fallback = false,
} = {}) => {
    if (shouldTrustProviderVerification({ authUser, authToken, authSession, authUid, user })) {
        return true;
    }

    const booleanSignals = [
        authSession?.emailVerified,
        authToken?.email_verified,
        authUser?.emailVerified,
        authUser?.isVerified,
        user?.isVerified,
    ].filter((value) => typeof value === 'boolean');

    if (booleanSignals.includes(true)) {
        return true;
    }

    if (booleanSignals.length > 0) {
        return false;
    }

    return Boolean(fallback);
};

const buildIdentityQuery = ({ email = '', authUid = '' } = {}) => {
    const safeEmail = normalizeEmail(email);
    const safeUid = normalizeUid(authUid);

    if (safeEmail && safeUid) {
        return {
            $or: [
                { authUid: safeUid },
                { email: safeEmail },
            ],
        };
    }

    if (safeUid) {
        return { authUid: safeUid };
    }

    if (safeEmail) {
        return { email: safeEmail };
    }

    return null;
};

module.exports = {
    INTERNAL_AUTH_EMAIL_DOMAIN,
    normalizeEmail,
    normalizeUid,
    normalizeText,
    buildInternalAuthEmail,
    isInternalAuthEmail,
    resolvePublicEmail,
    resolveProviderIds,
    isTrustedSocialProvider,
    shouldTrustProviderVerification,
    resolveEmailVerifiedState,
    buildIdentityQuery,
};

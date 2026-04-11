const INTERNAL_AUTH_EMAIL_DOMAIN = 'auth.aura.invalid';

const normalizeEmail = (value) => (
    typeof value === 'string' ? value.trim().toLowerCase() : ''
);

const normalizeUid = (value) => (
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
    buildInternalAuthEmail,
    isInternalAuthEmail,
    resolvePublicEmail,
    buildIdentityQuery,
};

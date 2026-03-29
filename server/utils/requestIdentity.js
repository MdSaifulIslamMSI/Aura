const IDENTITY_SEGMENT_PATTERN = /[^A-Za-z0-9:._-]/g;
const DEFAULT_SEGMENT_MAX_LENGTH = 120;

const sanitizeRequestIdentitySegment = (value, fallback = '', maxLength = DEFAULT_SEGMENT_MAX_LENGTH) => {
    const normalized = String(value || '')
        .trim()
        .replace(IDENTITY_SEGMENT_PATTERN, '')
        .slice(0, maxLength);

    return normalized || fallback;
};

const getTrustedRequestIp = (req = {}) => sanitizeRequestIdentitySegment(
    req.ip || req.socket?.remoteAddress || req.connection?.remoteAddress || '',
    'unknown',
);

const getAuthenticatedRateLimitIdentity = (req = {}) => {
    const principal = sanitizeRequestIdentitySegment(
        req.authUid || req.user?._id || req.user?.id || '',
    );

    if (principal) {
        return `uid:${principal}`;
    }

    return `ip:${getTrustedRequestIp(req)}`;
};

module.exports = {
    sanitizeRequestIdentitySegment,
    getTrustedRequestIp,
    getAuthenticatedRateLimitIdentity,
};

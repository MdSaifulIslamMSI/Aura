const net = require('net');

const IDENTITY_SEGMENT_PATTERN = /[^A-Za-z0-9:._-]/g;
const DEFAULT_SEGMENT_MAX_LENGTH = 120;
const CLOUDFRONT_VIEWER_ADDRESS_HEADER = 'cloudfront-viewer-address';

const sanitizeRequestIdentitySegment = (value, fallback = '', maxLength = DEFAULT_SEGMENT_MAX_LENGTH) => {
    const normalized = String(value || '')
        .trim()
        .replace(IDENTITY_SEGMENT_PATTERN, '')
        .slice(0, maxLength);

    return normalized || fallback;
};

// CloudFront-Viewer-Address is only meaningful after originProtectionMiddleware
// has verified the shared edge secret. The flag prevents a direct-origin client
// from choosing its own rate-limit identity by sending the same header.
const parseCloudFrontViewerAddress = (value = '') => {
    const raw = String(value || '').trim();
    if (!raw) return '';

    if (net.isIP(raw)) return raw;

    const bracketedIpv6 = raw.match(/^\[([^\]]+)\](?::\d+)?$/);
    if (bracketedIpv6 && net.isIP(bracketedIpv6[1])) return bracketedIpv6[1];

    const ipv4WithPort = raw.match(/^(\d{1,3}(?:\.\d{1,3}){3}):\d+$/);
    if (ipv4WithPort && net.isIP(ipv4WithPort[1])) return ipv4WithPort[1];

    return '';
};

const getTrustedRequestIp = (req = {}) => {
    const verifiedViewerIp = req.auraOriginVerified
        ? parseCloudFrontViewerAddress(req.headers?.[CLOUDFRONT_VIEWER_ADDRESS_HEADER])
        : '';

    return sanitizeRequestIdentitySegment(
        verifiedViewerIp || req.ip || req.socket?.remoteAddress || req.connection?.remoteAddress || '',
        'unknown',
    );
};

const getAuthenticatedRateLimitIdentity = (req = {}) => {
    const principal = sanitizeRequestIdentitySegment(
        req.authUid || req.user?._id || req.user?.id || '',
    );

    if (principal) {
        return `uid:${principal}`;
    }

    return `ip:${getTrustedRequestIp(req)}`;
};

const getAuthenticatedSessionRateLimitIdentity = (req = {}) => {
    const sessionId = sanitizeRequestIdentitySegment(req.authSession?.sessionId || '');
    return sessionId ? `session:${sessionId}` : '';
};

module.exports = {
    sanitizeRequestIdentitySegment,
    parseCloudFrontViewerAddress,
    getTrustedRequestIp,
    getAuthenticatedRateLimitIdentity,
    getAuthenticatedSessionRateLimitIdentity,
};

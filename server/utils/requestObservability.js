const crypto = require('crypto');

const processLogSalt = crypto.randomBytes(32);
const MONGO_ID = /^[0-9a-f]{24}$/i;
const UUID = /^[0-9a-f-]{36}$/i;

const getHashKey = () => {
    const configured = String(
        process.env.OBSERVABILITY_HASH_SECRET
        || process.env.SESSION_HASH_SECRET
        || process.env.SESSION_SECRET
        || ''
    ).trim();
    return configured || processLogSalt;
};

const hashLogIdentifier = (value, prefix) => {
    const normalized = String(value || '').trim();
    if (!normalized) return '';
    return `${prefix}_${crypto
        .createHmac('sha256', getHashKey())
        .update(normalized)
        .digest('hex')
        .slice(0, 16)}`;
};

const minimizeRequestPath = (value = '') => {
    const path = String(value || '').split('?')[0].split('#')[0] || '/';
    return path
        .split('/')
        .map((segment) => {
            if (MONGO_ID.test(segment)) return ':id';
            if (UUID.test(segment)) return ':uuid';
            if (/^\d+$/.test(segment)) return ':num';
            return segment;
        })
        .join('/') || '/';
};

const minimizeTelemetryUrl = (value = '') => {
    const normalized = String(value || '').trim();
    if (!normalized) return '';

    try {
        return minimizeRequestPath(new URL(normalized, 'https://telemetry.invalid').pathname);
    } catch {
        return minimizeRequestPath(normalized);
    }
};

const normalizeUserAgentFamily = (value = '') => {
    const normalized = String(value || '').toLowerCase();
    if (!normalized) return '';

    const browser = normalized.includes('edg/')
        ? 'edge'
        : normalized.includes('firefox/')
            ? 'firefox'
            : normalized.includes('chrome/') || normalized.includes('crios/')
                ? 'chrome'
                : normalized.includes('safari/')
                    ? 'safari'
                    : 'other';
    const platform = normalized.includes('android')
        ? 'android'
        : /iphone|ipad|ipod/.test(normalized)
            ? 'ios'
            : normalized.includes('windows')
                ? 'windows'
                : normalized.includes('mac os')
                    ? 'macos'
                    : normalized.includes('linux')
                        ? 'linux'
                        : 'other';

    return `${browser}/${platform}`;
};

const buildPrivacySafeRequestLogContext = (req = {}) => ({
    method: String(req.method || ''),
    url: minimizeRequestPath(req.originalUrl || req.url || req.path || ''),
    requestId: String(req.requestId || req.headers?.['x-request-id'] || 'unknown'),
    clientSessionRef: hashLogIdentifier(req.headers?.['x-client-session-id'], 'cs'),
    clientRoute: minimizeRequestPath(req.headers?.['x-client-route'] || ''),
    ipRef: hashLogIdentifier(req.ip || req.socket?.remoteAddress, 'ip'),
});

module.exports = {
    buildPrivacySafeRequestLogContext,
    hashLogIdentifier,
    minimizeRequestPath,
    minimizeTelemetryUrl,
    normalizeUserAgentFamily,
};

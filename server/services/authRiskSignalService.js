const crypto = require('crypto');

const LOGIN_RISK_SIGNAL_HEADERS = Object.freeze({
    recentFailureCount: 'x-aura-login-failure-count',
    ipReputation: 'x-aura-ip-reputation',
    impossibleTravel: 'x-aura-impossible-travel',
});

const LOGIN_RISK_SIGNATURE_HEADER = 'x-aura-login-risk-signature';
const LOGIN_RISK_TIMESTAMP_HEADER = 'x-aura-login-risk-timestamp';
const LOGIN_RISK_SIGNATURE_VERSION = 'v1';
const DEFAULT_MAX_AGE_SECONDS = 120;
const LOGIN_RISK_SIGNAL_HEADER_NAMES = Object.freeze([
    ...Object.values(LOGIN_RISK_SIGNAL_HEADERS),
    LOGIN_RISK_SIGNATURE_HEADER,
    LOGIN_RISK_TIMESTAMP_HEADER,
]);

const TRUE_VALUES = new Set(['1', 'true', 'yes', 'on']);

const safeString = (value, fallback = '') => String(value === undefined || value === null ? fallback : value).trim();

const parsePositiveInteger = (value) => {
    const numeric = Number(value || 0);
    return Number.isFinite(numeric) && numeric > 0 ? Math.trunc(numeric) : 0;
};

const parseBooleanSignal = (value) => TRUE_VALUES.has(safeString(value).toLowerCase());

const normalizeIpReputation = (value = '') => safeString(value)
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 80);

const normalizePath = (value = '') => {
    const rawPath = safeString(value || '/').split('?')[0] || '/';
    return rawPath.startsWith('/') ? rawPath : `/${rawPath}`;
};

const getRequestPath = (req = {}) => normalizePath(req.originalUrl || req.path || req.url || '/');

const normalizeSignals = (signals = {}) => ({
    recentFailureCount: parsePositiveInteger(signals.recentFailureCount),
    ipReputation: normalizeIpReputation(signals.ipReputation),
    impossibleTravel: parseBooleanSignal(signals.impossibleTravel),
});

const readHeader = (req = {}, headerName = '') => safeString(
    req.get?.(headerName)
    || req.headers?.[String(headerName).toLowerCase()]
    || req.headers?.[headerName]
);

const readHeaderSignals = (req = {}) => normalizeSignals({
    recentFailureCount: readHeader(req, LOGIN_RISK_SIGNAL_HEADERS.recentFailureCount),
    ipReputation: readHeader(req, LOGIN_RISK_SIGNAL_HEADERS.ipReputation),
    impossibleTravel: readHeader(req, LOGIN_RISK_SIGNAL_HEADERS.impossibleTravel),
});

const hasAnySignal = (signals = {}) => (
    parsePositiveInteger(signals.recentFailureCount) > 0
    || Boolean(normalizeIpReputation(signals.ipReputation))
    || parseBooleanSignal(signals.impossibleTravel)
);

const getCurrentSecret = () => safeString(process.env.AUTH_RISK_SIGNAL_SECRET);

const getPreviousSecrets = () => safeString(process.env.AUTH_RISK_SIGNAL_PREVIOUS_SECRETS)
    .split(',')
    .map((secret) => safeString(secret.replace(/^v\d+:/i, '')))
    .filter(Boolean);

const getSigningSecrets = () => {
    const secrets = [
        getCurrentSecret(),
        ...getPreviousSecrets(),
    ].filter(Boolean);
    return Array.from(new Set(secrets));
};

const assertAuthRiskSignalConfig = (env = process.env) => {
    const riskEngineMode = safeString(env.AUTH_RISK_ENGINE_MODE).toLowerCase();
    const riskSignalSecret = safeString(env.AUTH_RISK_SIGNAL_SECRET);
    if (riskEngineMode === 'enforce' && !riskSignalSecret) {
        throw new Error('AUTH_RISK_SIGNAL_SECRET is required when AUTH_RISK_ENGINE_MODE=enforce.');
    }
};

const getMaxAgeMs = () => {
    const configured = parsePositiveInteger(process.env.AUTH_RISK_SIGNAL_MAX_AGE_SECONDS);
    return (configured || DEFAULT_MAX_AGE_SECONDS) * 1000;
};

const deleteHeader = (req = {}, headerName = '') => {
    if (!req.headers) return;
    const normalizedHeaderName = safeString(headerName).toLowerCase();
    delete req.headers[normalizedHeaderName];
    delete req.headers[headerName];
};

const setHeader = (req = {}, headerName = '', value = '') => {
    if (!req.headers) {
        req.headers = {};
    }
    req.headers[safeString(headerName).toLowerCase()] = safeString(value);
};

const stripLoginRiskSignalHeaders = (req = {}) => {
    for (const headerName of LOGIN_RISK_SIGNAL_HEADER_NAMES) {
        deleteHeader(req, headerName);
    }
};

const resolveTimestampMs = (timestamp = '') => {
    const numeric = Number(timestamp);
    if (Number.isFinite(numeric) && numeric > 0) {
        return numeric > 10_000_000_000 ? Math.trunc(numeric) : Math.trunc(numeric * 1000);
    }
    const parsed = new Date(timestamp).getTime();
    return Number.isFinite(parsed) ? parsed : 0;
};

const timingSafeEqualText = (left = '', right = '') => {
    const leftBuffer = Buffer.from(String(left));
    const rightBuffer = Buffer.from(String(right));
    return leftBuffer.length === rightBuffer.length
        && crypto.timingSafeEqual(leftBuffer, rightBuffer);
};

const buildLoginRiskSignalSignatureBase = ({
    method = '',
    path = '',
    deviceId = '',
    signals = {},
    timestamp = '',
} = {}) => {
    const normalizedSignals = normalizeSignals(signals);
    return [
        LOGIN_RISK_SIGNATURE_VERSION,
        safeString(method).toUpperCase(),
        normalizePath(path),
        safeString(deviceId).slice(0, 160),
        String(normalizedSignals.recentFailureCount),
        normalizedSignals.ipReputation,
        normalizedSignals.impossibleTravel ? '1' : '0',
        safeString(timestamp),
    ].join('\n');
};

const signLoginRiskSignals = ({
    method = 'POST',
    path = '/api/auth/sync',
    deviceId = '',
    signals = {},
    timestamp = '',
    secret = '',
} = {}) => {
    const normalizedSecret = safeString(secret);
    if (!normalizedSecret) return '';

    const digest = crypto.createHmac('sha256', normalizedSecret)
        .update(buildLoginRiskSignalSignatureBase({
            method,
            path,
            deviceId,
            signals,
            timestamp,
        }))
        .digest('hex');

    return `${LOGIN_RISK_SIGNATURE_VERSION}=${digest}`;
};

const writeSignedLoginRiskSignalHeaders = ({
    req = {},
    method = req.method || 'POST',
    path = getRequestPath(req),
    deviceId = '',
    signals = {},
    timestamp = new Date().toISOString(),
    secret = getCurrentSecret(),
} = {}) => {
    const normalizedSignals = normalizeSignals(signals);
    const normalizedSecret = safeString(secret);

    if (!hasAnySignal(normalizedSignals)) {
        stripLoginRiskSignalHeaders(req);
        return {
            signed: false,
            reason: 'no_signals',
            signals: normalizedSignals,
        };
    }

    if (!normalizedSecret) {
        stripLoginRiskSignalHeaders(req);
        return {
            signed: false,
            reason: 'missing_secret',
            signals: normalizeSignals({}),
        };
    }

    const signature = signLoginRiskSignals({
        method,
        path,
        deviceId,
        signals: normalizedSignals,
        timestamp,
        secret: normalizedSecret,
    });

    stripLoginRiskSignalHeaders(req);
    setHeader(req, LOGIN_RISK_SIGNAL_HEADERS.recentFailureCount, normalizedSignals.recentFailureCount);
    setHeader(req, LOGIN_RISK_SIGNAL_HEADERS.ipReputation, normalizedSignals.ipReputation);
    setHeader(req, LOGIN_RISK_SIGNAL_HEADERS.impossibleTravel, normalizedSignals.impossibleTravel ? 'true' : '');
    setHeader(req, LOGIN_RISK_TIMESTAMP_HEADER, timestamp);
    setHeader(req, LOGIN_RISK_SIGNATURE_HEADER, signature);

    return {
        signed: true,
        reason: 'signed',
        signals: normalizedSignals,
        signature,
        timestamp,
    };
};

const verifySignedHeaderSignals = ({
    req = {},
    signals = {},
    deviceId = '',
} = {}) => {
    const signature = readHeader(req, LOGIN_RISK_SIGNATURE_HEADER);
    const timestamp = readHeader(req, LOGIN_RISK_TIMESTAMP_HEADER);
    if (!signature || !timestamp) {
        return { trusted: false, reason: 'missing_signature' };
    }

    const timestampMs = resolveTimestampMs(timestamp);
    if (!timestampMs || Math.abs(Date.now() - timestampMs) > getMaxAgeMs()) {
        return { trusted: false, reason: 'stale_signature' };
    }

    const secrets = getSigningSecrets();
    if (secrets.length === 0) {
        return { trusted: false, reason: 'missing_secret' };
    }

    const expectedBase = {
        method: req.method || '',
        path: getRequestPath(req),
        deviceId,
        signals,
        timestamp,
    };

    const valid = secrets.some((secret) => timingSafeEqualText(
        signLoginRiskSignals({ ...expectedBase, secret }),
        signature
    ));

    return {
        trusted: valid,
        reason: valid ? 'verified' : 'invalid_signature',
    };
};

const extractTrustedLoginRiskSignals = (req = {}, { deviceId = '' } = {}) => {
    if (req.authRisk && typeof req.authRisk === 'object') {
        return {
            signals: normalizeSignals(req.authRisk),
            trusted: true,
            source: 'server',
            ignoredUntrustedHeaders: false,
            reason: 'server_context',
        };
    }

    const headerSignals = readHeaderSignals(req);
    const hasHeaderSignals = hasAnySignal(headerSignals);
    if (!hasHeaderSignals) {
        return {
            signals: headerSignals,
            trusted: false,
            source: 'none',
            ignoredUntrustedHeaders: false,
            reason: 'no_signals',
        };
    }

    const verification = verifySignedHeaderSignals({ req, signals: headerSignals, deviceId });
    if (!verification.trusted) {
        return {
            signals: normalizeSignals({}),
            trusted: false,
            source: 'untrusted_header',
            ignoredUntrustedHeaders: true,
            reason: verification.reason,
        };
    }

    return {
        signals: headerSignals,
        trusted: true,
        source: 'signed_header',
        ignoredUntrustedHeaders: false,
        reason: verification.reason,
    };
};

module.exports = {
    LOGIN_RISK_SIGNAL_HEADERS,
    LOGIN_RISK_SIGNAL_HEADER_NAMES,
    LOGIN_RISK_SIGNATURE_HEADER,
    LOGIN_RISK_TIMESTAMP_HEADER,
    assertAuthRiskSignalConfig,
    buildLoginRiskSignalSignatureBase,
    extractTrustedLoginRiskSignals,
    signLoginRiskSignals,
    stripLoginRiskSignalHeaders,
    writeSignedLoginRiskSignalHeaders,
    __private: {
        hasAnySignal,
        normalizeSignals,
        verifySignedHeaderSignals,
    },
};

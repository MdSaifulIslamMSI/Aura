const crypto = require('crypto');
const { getTrustedRequestIp } = require('../../utils/requestIdentity');

const STATE_CHANGING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

const stableStringify = (value) => {
    if (value === null || value === undefined) return '';
    if (typeof value !== 'object') return JSON.stringify(value);
    if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
};

const hashBody = (body) => {
    if (!body || typeof body !== 'object' || Object.keys(body).length === 0) return '';
    return crypto.createHash('sha256').update(stableStringify(body)).digest('hex');
};

const normalizeRoute = (req = {}) => String(req.originalUrl || req.path || req.url || '')
    .split('?')[0]
    .trim();

const buildSessionContext = (req = {}, identity = {}) => {
    const method = String(req.method || 'GET').toUpperCase();
    const authTime = Number(identity.authTime || req.authToken?.auth_time || req.authToken?.iat || 0);
    const nowSeconds = Math.floor(Date.now() / 1000);

    return {
        requestId: String(req.requestId || req.headers?.['x-request-id'] || '').trim(),
        sessionId: String(identity.sessionId || req.authSession?.sessionId || req.headers?.['x-aura-session-id'] || '').trim(),
        authTime: authTime > 0 ? authTime : null,
        authAgeSeconds: authTime > 0 ? Math.max(nowSeconds - authTime, 0) : null,
        method,
        path: normalizeRoute(req),
        ip: getTrustedRequestIp(req),
        userAgent: String(req.headers?.['user-agent'] || '').trim(),
        deviceId: String(req.headers?.['x-aura-device-id'] || req.authSession?.deviceId || '').trim(),
        nonce: String(req.headers?.['x-aura-nonce'] || req.headers?.['x-request-nonce'] || '').trim(),
        timestamp: String(req.headers?.['x-aura-timestamp'] || '').trim(),
        dpopHeader: String(req.headers?.dpop || req.headers?.DPoP || req.get?.('DPoP') || '').trim(),
        proofHeader: String(req.headers?.['x-aura-request-proof'] || req.get?.('X-Aura-Request-Proof') || '').trim(),
        bodyHash: hashBody(req.body),
        isStateChanging: STATE_CHANGING_METHODS.has(method),
    };
};

module.exports = {
    STATE_CHANGING_METHODS,
    buildSessionContext,
    hashBody,
    stableStringify,
};

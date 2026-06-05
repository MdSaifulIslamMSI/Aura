const { hashValue } = require('./redaction');

const toText = (value = '') => String(value || '').trim();

const safeNumber = (value, fallback = null) => {
    const numeric = Number(value);
    return Number.isFinite(numeric) && numeric >= 0 ? numeric : fallback;
};

const firstForwardedIp = (value = '') => toText(value).split(',')[0].trim();

const resolveActorId = (req = {}) => toText(
    req.user?._id
    || req.user?.id
    || req.authSession?.userId
    || req.authUid
    || ''
);

const resolveActorRole = (req = {}) => {
    if (req.user?.isAdmin) return 'admin';
    const roles = [
        req.user?.role,
        ...(Array.isArray(req.user?.roles) ? req.user.roles : []),
        ...(Array.isArray(req.user?.adminRoles) ? req.user.adminRoles : []),
    ].map((entry) => toText(entry).toLowerCase()).filter(Boolean);
    return roles[0] || 'anonymous';
};

const resolveTenantId = (req = {}, resource = {}) => toText(
    req.tenantId
    || req.user?.tenantId
    || req.user?.tenant
    || req.authSession?.tenantId
    || req.headers?.['x-aura-tenant-id']
    || resource.actorTenantId
    || ''
);

const resolveSessionAgeSeconds = (req = {}) => {
    const postureAge = safeNumber(req.authzPosture?.authAgeSeconds);
    if (postureAge !== null) return postureAge;

    const authTime = safeNumber(req.authToken?.auth_time);
    if (authTime !== null && authTime > 0) {
        return Math.max(0, Math.floor(Date.now() / 1000) - authTime);
    }

    const sessionCreatedAt = req.authSession?.createdAt || req.authSession?.issuedAt;
    const createdAtMillis = new Date(sessionCreatedAt || 0).getTime();
    if (Number.isFinite(createdAtMillis) && createdAtMillis > 0) {
        return Math.max(0, Math.floor((Date.now() - createdAtMillis) / 1000));
    }

    return null;
};

const resolveMfaFresh = (req = {}) => Boolean(
    req.mfaFresh
    || req.authzPosture?.stepUpFresh
    || req.authzPosture?.webAuthnStepUpFresh
    || req.authzPosture?.freshWebAuthnStepUp
    || req.authzPosture?.elevatedAssurance
);

const resolveTrustedDevice = (req = {}) => Boolean(
    req.trustedDevice?.verified
    || req.authzPosture?.trustedDevice
    || req.authSession?.deviceMethod === 'trusted_device'
    || (Array.isArray(req.authSession?.amr) && req.authSession.amr.includes('trusted_device'))
);

const resolvePayloadSize = (req = {}) => {
    const contentLength = safeNumber(req.headers?.['content-length']);
    if (contentLength !== null) return contentLength;
    try {
        return Buffer.byteLength(JSON.stringify(req.body || {}), 'utf8');
    } catch {
        return 0;
    }
};

const buildRequestSecurityContext = (req = {}, {
    action = '',
    resource = {},
} = {}) => {
    try {
        const ip = firstForwardedIp(req.headers?.['x-forwarded-for']) || toText(req.ip || req.socket?.remoteAddress);
        const userAgent = toText(req.headers?.['user-agent']);
        const path = toText(req.originalUrl || req.path || req.url || '/').split('?')[0] || '/';

        return {
            requestId: toText(req.requestId || req.headers?.['x-request-id']),
            actorId: resolveActorId(req),
            actorRole: resolveActorRole(req),
            tenantId: resolveTenantId(req, resource),
            sessionAgeSeconds: resolveSessionAgeSeconds(req),
            mfaFresh: resolveMfaFresh(req),
            trustedDevice: resolveTrustedDevice(req),
            ipHash: hashValue(ip),
            userAgentHash: hashValue(userAgent),
            method: toText(req.method || 'GET').toUpperCase(),
            path,
            action: toText(action || resource.action),
            resourceType: toText(resource.type || resource.resourceType),
            resourceId: toText(resource.id || resource.resourceId),
            payloadSize: resolvePayloadSize(req),
            timestamp: new Date().toISOString(),
        };
    } catch {
        return {
            requestId: '',
            actorId: '',
            actorRole: 'anonymous',
            tenantId: '',
            sessionAgeSeconds: null,
            mfaFresh: false,
            trustedDevice: false,
            ipHash: '',
            userAgentHash: '',
            method: '',
            path: '',
            action: toText(action),
            resourceType: toText(resource.type || resource.resourceType),
            resourceId: toText(resource.id || resource.resourceId),
            payloadSize: 0,
            timestamp: new Date().toISOString(),
        };
    }
};

module.exports = {
    buildRequestSecurityContext,
    resolveActorId,
    resolveActorRole,
    resolveTenantId,
};

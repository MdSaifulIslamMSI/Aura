const {
    hashSecurityValue,
} = require('./redactSecurityMetadata');

const truthy = (value) => ['1', 'true', 'yes', 'on'].includes(String(value || '').trim().toLowerCase());

const resolveUserId = (req = {}) => (
    req.user?._id
    || req.user?.id
    || req.authSession?.userId
    || req.authUid
    || ''
);

const resolveRole = (req = {}) => (
    req.user?.role
    || (req.user?.isAdmin ? 'admin' : '')
    || ''
);

const resolveTenantId = (req = {}) => (
    req.user?.tenantId
    || req.params?.tenantId
    || req.body?.tenantId
    || ''
);

const resolveSessionAgeSeconds = (req = {}) => {
    if (Number.isFinite(Number(req.sessionAgeSeconds))) return Number(req.sessionAgeSeconds);
    const issuedAt = req.authSession?.issuedAt || req.authSession?.createdAt || req.session?.createdAt;
    if (!issuedAt) return null;
    const issuedAtMs = issuedAt instanceof Date ? issuedAt.getTime() : Number(new Date(issuedAt).getTime());
    if (!Number.isFinite(issuedAtMs)) return null;
    return Math.max(0, Math.floor((Date.now() - issuedAtMs) / 1000));
};

const buildSecurityContext = (req = {}, overrides = {}) => {
    const userId = overrides.userId ?? resolveUserId(req);
    const tenantId = overrides.tenantId ?? resolveTenantId(req);
    const route = overrides.route || req.originalUrl || req.path || '';
    const userAgent = req.headers?.['user-agent'] || '';
    const ip = req.ip || req.headers?.['x-forwarded-for'] || req.socket?.remoteAddress || '';

    return {
        userId: userId ? String(userId) : '',
        role: overrides.role ?? resolveRole(req),
        tenantId: tenantId ? String(tenantId) : '',
        resourceId: overrides.resourceId ?? req.params?.id ?? req.params?.resourceId ?? '',
        resourceOwnerId: overrides.resourceOwnerId ?? req.resource?.ownerId ?? req.resource?.userId ?? '',
        action: overrides.action || '',
        route,
        method: overrides.method || req.method || '',
        ipHash: overrides.ipHash || hashSecurityValue(ip),
        userAgentHash: overrides.userAgentHash || hashSecurityValue(userAgent),
        deviceTrust: overrides.deviceTrust || req.deviceTrust || req.authShieldDecision?.deviceTrust || 'unknown',
        sessionAgeSeconds: overrides.sessionAgeSeconds ?? resolveSessionAgeSeconds(req),
        mfaFresh: overrides.mfaFresh ?? Boolean(req.authSession?.mfaFresh || req.user?.mfaFresh || req.securityStepUp?.mfaFresh),
        passkeyFresh: overrides.passkeyFresh ?? Boolean(req.authSession?.passkeyFresh || req.user?.passkeyFresh || req.securityStepUp?.passkeyFresh),
        csrfVerified: overrides.csrfVerified ?? Boolean(req.csrfValidated || req.csrfVerified || truthy(req.headers?.['x-csrf-verified'])),
        requestVelocity: overrides.requestVelocity ?? req.securitySignals?.requestVelocity ?? 0,
        failedAttemptCount: overrides.failedAttemptCount ?? req.securitySignals?.failedAttemptCount ?? 0,
        previousSecurityEvents: overrides.previousSecurityEvents ?? req.securitySignals?.previousSecurityEvents ?? 0,
        payloadRisk: overrides.payloadRisk ?? req.securitySignals?.payloadRisk ?? 0,
        environment: overrides.environment || process.env.NODE_ENV || 'development',
        isProduction: overrides.isProduction ?? (process.env.NODE_ENV === 'production'),
    };
};

module.exports = {
    buildSecurityContext,
};

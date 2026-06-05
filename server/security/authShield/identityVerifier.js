const {
    isSensitive,
    normalizeText,
} = require('./types');

const normalizeId = (value = '') => String(value || '').trim();

const unique = (entries = []) => [...new Set(entries.map(normalizeText).filter(Boolean))];

const resolveAuthTime = (req = {}) => {
    const candidates = [
        req.authToken?.auth_time,
        req.authToken?.iat,
        req.authSession?.authTime,
        req.authSession?.authTimeSeconds,
        req.user?.authAssuranceAuthTime,
    ];
    for (const candidate of candidates) {
        const value = Number(candidate);
        if (Number.isFinite(value) && value > 0) return value;
    }
    return 0;
};

const resolveMfaLevel = (req = {}) => {
    const amr = [
        ...(Array.isArray(req.authSession?.amr) ? req.authSession.amr : []),
        ...(Array.isArray(req.authToken?.amr) ? req.authToken.amr : []),
    ].map(normalizeText);
    if (amr.some((entry) => entry === 'webauthn' || entry === 'passkey' || entry === 'duo' || entry === 'duo_oidc')) {
        return 'phishing_resistant';
    }
    if (amr.some((entry) => entry === 'mfa' || entry === 'otp' || entry === 'totp' || entry === 'sms' || entry === 'trusted_device')) {
        return 'second_factor';
    }
    if (req.user?.mfa?.enabled || req.user?.trustedDevices?.length > 0) {
        return 'available';
    }
    return 'none';
};

const resolveRoles = (user = {}) => {
    const roles = [];
    if (user?.isAdmin === true) roles.push('admin');
    if (user?.isSeller === true) roles.push('seller');
    if (Array.isArray(user?.adminRoles) && user.adminRoles.length > 0 && user?.isAdmin === true) {
        roles.push(...user.adminRoles);
    }
    if (Array.isArray(user?.roles)) {
        roles.push(...user.roles.filter((role) => normalizeText(role) !== 'admin' || user?.isAdmin === true));
    }
    if (user?.role && (normalizeText(user.role) !== 'admin' || user?.isAdmin === true)) {
        roles.push(user.role);
    }
    if (roles.length === 0) roles.push('user');
    return unique(roles);
};

const resolveAccountStatus = (user = {}) => {
    if (user?.softDeleted) return 'deleted';
    return normalizeText(user?.accountState || user?.status || 'active');
};

const verifyIdentity = (req = {}, { sensitivity = 'medium' } = {}) => {
    const userId = normalizeId(req.user?._id || req.user?.id || req.authSession?.userId || req.authUid || '');
    const nowSeconds = Math.floor(Date.now() / 1000);
    const authTime = resolveAuthTime(req);
    const tokenAgeSeconds = authTime > 0 ? Math.max(nowSeconds - authTime, 0) : null;
    const accountStatus = resolveAccountStatus(req.user || {});
    const roles = resolveRoles(req.user || {});
    const emailVerified = Boolean(
        req.authIdentity?.emailVerified
        || req.authToken?.email_verified
        || req.user?.isVerified
    );
    const reasons = [];

    if (!userId) reasons.push('identity_missing');
    if (['disabled', 'banned', 'deleted', 'blocked', 'suspended'].includes(accountStatus)) {
        reasons.push(`account_${accountStatus}`);
    }
    if (isSensitive(sensitivity) && !emailVerified) {
        reasons.push('identity_unverified');
    }

    const identity = {
        userId,
        roles,
        provider: normalizeText(req.authProvider || req.authSession?.provider || 'legacy') || 'legacy',
        emailVerified,
        accountStatus,
        authTime: authTime || null,
        tokenAgeSeconds,
        mfaLevel: resolveMfaLevel(req),
        tenantId: normalizeId(req.user?.tenantId || req.user?.storeId || req.user?.sellerId || ''),
        sessionId: normalizeId(req.authSession?.sessionId || req.headers?.['x-aura-session-id'] || ''),
        hasAdminRole: roles.includes('admin'),
        hasSellerRole: roles.includes('seller'),
    };

    return {
        ok: reasons.length === 0,
        identity,
        reasons,
    };
};

module.exports = {
    resolveAccountStatus,
    resolveAuthTime,
    resolveMfaLevel,
    resolveRoles,
    verifyIdentity,
};

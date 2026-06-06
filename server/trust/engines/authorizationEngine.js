const normalizeRole = (value = '') => String(value || '').trim().toLowerCase();

const hasAllowedRole = (actor = {}, allowedRoles = []) => {
    const allowed = new Set((allowedRoles || []).map(normalizeRole).filter(Boolean));
    if (allowed.size === 0) return true;
    const actorRoles = new Set([
        actor.role,
        ...(Array.isArray(actor.roles) ? actor.roles : []),
    ].map(normalizeRole).filter(Boolean));
    return [...actorRoles].some((role) => allowed.has(role));
};

const evaluateAuthorization = ({ actor = {}, policy = {} } = {}) => {
    if (hasAllowedRole(actor, policy.allowedRoles)) {
        return {
            ok: true,
            reason: 'PERMISSION_ALLOWED',
        };
    }

    return {
        ok: false,
        reason: 'PERMISSION_DENIED',
        allowedRoles: policy.allowedRoles || [],
        actorRole: actor.role || '',
    };
};

module.exports = {
    evaluateAuthorization,
    hasAllowedRole,
};

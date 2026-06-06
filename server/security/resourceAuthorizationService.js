const sameId = (left, right) => {
    if (!left || !right) return false;
    return String(left) === String(right);
};

const hasRole = (actor = {}, role = '') => {
    const normalized = String(role || '').trim().toLowerCase();
    if (!normalized) return true;
    const actorRole = String(actor.role || '').trim().toLowerCase();
    if (actorRole === normalized) return true;
    const roles = Array.isArray(actor.roles) ? actor.roles : [];
    return roles.map((entry) => String(entry || '').trim().toLowerCase()).includes(normalized);
};

const verifyResourceAuthorization = ({
    actor = {},
    resource = {},
    tenantId = '',
    resourceOwnerId = '',
    requiredRole = '',
    allowAdminOverride = true,
    supportRedaction = true,
    resourceSensitivity = 'medium',
} = {}) => {
    const actorId = actor?._id || actor?.id || actor?.userId || '';
    const actorTenantId = actor?.tenantId || tenantId || '';
    const resourceTenantId = resource?.tenantId || resource?.tenant || '';
    const ownerId = resourceOwnerId || resource?.ownerId || resource?.userId || resource?.sellerId || '';
    const actorRole = String(actor?.role || '').trim().toLowerCase();

    if (!actorId) {
        return { allowed: false, reasonCode: 'actor_missing', redacted: false, auditRequired: true };
    }
    if (resource?.deleted || resource?.disabled || resource?.state === 'deleted' || resource?.state === 'disabled') {
        return { allowed: false, reasonCode: 'resource_inactive', redacted: false, auditRequired: true };
    }
    if (requiredRole && !hasRole(actor, requiredRole)) {
        return { allowed: false, reasonCode: 'role_missing', redacted: false, auditRequired: true };
    }
    if (resourceTenantId && actorTenantId && !sameId(actorTenantId, resourceTenantId)) {
        return { allowed: false, reasonCode: 'tenant_mismatch', redacted: false, auditRequired: true };
    }
    if (ownerId && sameId(actorId, ownerId)) {
        return { allowed: true, reasonCode: 'owner_match', redacted: false, auditRequired: false };
    }
    if (actorRole === 'support' && supportRedaction) {
        return {
            allowed: true,
            reasonCode: 'support_redacted',
            redacted: true,
            auditRequired: true,
            resourceSensitivity,
        };
    }
    if (allowAdminOverride && actorRole === 'admin') {
        return { allowed: true, reasonCode: 'admin_override', redacted: false, auditRequired: true };
    }
    if (ownerId) {
        return { allowed: false, reasonCode: 'owner_mismatch', redacted: false, auditRequired: true };
    }

    return { allowed: true, reasonCode: 'resource_public_or_unowned', redacted: false, auditRequired: false };
};

module.exports = {
    hasRole,
    sameId,
    verifyResourceAuthorization,
};

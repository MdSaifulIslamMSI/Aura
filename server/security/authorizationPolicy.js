const normalizeId = (value = '') => String(value || '').trim();
const normalizeText = (value = '') => String(value || '').trim().toLowerCase();

const hasRole = (actor = {}, role = '') => {
    const expected = normalizeText(role);
    if (!expected) return true;
    if (expected === 'admin' && actor.isAdmin === true) return true;

    const roles = [
        actor.role,
        ...(Array.isArray(actor.roles) ? actor.roles : []),
        ...(Array.isArray(actor.adminRoles) ? actor.adminRoles : []),
    ].map(normalizeText);

    return roles.includes(expected);
};

const buildAuthorizationDecision = ({
    allowed = false,
    reasonCode = 'denied',
    actor = {},
    resource = {},
    action = '',
    requiredRole = '',
    ownerMatched = false,
    tenantMatched = false,
    adminOverride = false,
} = {}) => ({
    allowed: Boolean(allowed),
    reasonCode,
    actorUserId: normalizeId(actor?._id || actor?.id || actor?.userId),
    actorRole: normalizeText(actor?.role || (actor?.isAdmin ? 'admin' : 'user')),
    targetOwnerId: normalizeId(resource?.ownerId || resource?.userId),
    tenantId: normalizeId(resource?.tenantId || resource?.storeId || resource?.sellerId),
    actorTenantId: normalizeId(actor?.tenantId || actor?.storeId || actor?.sellerId),
    action,
    requiredRole,
    ownerMatched: Boolean(ownerMatched),
    tenantMatched: Boolean(tenantMatched),
    adminOverride: Boolean(adminOverride),
});

const evaluateResourceAuthorization = ({
    actor = {},
    resource = {},
    action = '',
    requiredRole = '',
    allowOwner = true,
    allowAdmin = false,
    requireTenantMatch = false,
} = {}) => {
    const actorUserId = normalizeId(actor?._id || actor?.id || actor?.userId);
    const targetOwnerId = normalizeId(resource?.ownerId || resource?.userId);
    const actorTenantId = normalizeId(actor?.tenantId || actor?.storeId || actor?.sellerId);
    const resourceTenantId = normalizeId(resource?.tenantId || resource?.storeId || resource?.sellerId);

    if (!actorUserId) {
        return buildAuthorizationDecision({ actor, resource, action, requiredRole, reasonCode: 'actor_missing' });
    }

    if (!resource || typeof resource !== 'object' || Object.keys(resource).length === 0) {
        return buildAuthorizationDecision({ actor, resource, action, requiredRole, reasonCode: 'resource_missing' });
    }

    if (requiredRole && !hasRole(actor, requiredRole)) {
        return buildAuthorizationDecision({ actor, resource, action, requiredRole, reasonCode: 'role_missing' });
    }

    const tenantMatched = !requireTenantMatch || (
        Boolean(actorTenantId)
        && Boolean(resourceTenantId)
        && actorTenantId === resourceTenantId
    );
    if (requireTenantMatch && !tenantMatched) {
        return buildAuthorizationDecision({ actor, resource, action, requiredRole, reasonCode: 'tenant_mismatch' });
    }

    const ownerMatched = Boolean(targetOwnerId && targetOwnerId === actorUserId);
    if (allowOwner && ownerMatched) {
        return buildAuthorizationDecision({
            allowed: true,
            reasonCode: 'owner_allowed',
            actor,
            resource,
            action,
            requiredRole,
            ownerMatched,
            tenantMatched,
        });
    }

    const adminOverride = Boolean(allowAdmin && actor.isAdmin === true);
    if (adminOverride) {
        return buildAuthorizationDecision({
            allowed: true,
            reasonCode: 'admin_allowed',
            actor,
            resource,
            action,
            requiredRole,
            ownerMatched,
            tenantMatched,
            adminOverride,
        });
    }

    return buildAuthorizationDecision({
        actor,
        resource,
        action,
        requiredRole,
        ownerMatched,
        tenantMatched,
        reasonCode: targetOwnerId ? 'owner_mismatch' : 'owner_missing',
    });
};

module.exports = {
    buildAuthorizationDecision,
    evaluateResourceAuthorization,
    hasRole,
};

const normalizeText = (value = '') => String(value || '').trim().toLowerCase();
const normalizeId = (value = '') => String(value || '').trim();

const KNOWN_RESOURCE_TYPES = new Set([
    'admin_control',
    'admin_notification',
    'analytics',
    'auth',
    'auth_factor',
    'cart',
    'listing',
    'listing_escrow',
    'message',
    'moderation',
    'order',
    'payment',
    'payment_method',
    'product',
    'review',
    'support_ticket',
    'tenant',
    'upload',
    'user',
]);

const KNOWN_ACTION_PREFIXES = [
    'admin.',
    'auth.',
    'cart.',
    'listing.',
    'message.',
    'moderation.',
    'order.',
    'payment.',
    'payment_method.',
    'product.',
    'review.',
    'support.',
    'tenant.',
    'upload.',
    'user.',
];

const hasRole = (actor = {}, role = '') => {
    const expected = normalizeText(role);
    if (!expected) return false;
    if (expected === 'admin' && actor.isAdmin === true) return true;
    return [
        actor.role,
        ...(Array.isArray(actor.roles) ? actor.roles : []),
        ...(Array.isArray(actor.adminRoles) ? actor.adminRoles : []),
    ].map(normalizeText).includes(expected);
};

const isDisabledActor = (actor = {}) => {
    const accountState = normalizeText(actor.accountState);
    return Boolean(actor.softDeleted)
        || ['deleted', 'disabled', 'suspended'].includes(accountState)
        || (actor.moderation?.suspendedUntil && new Date(actor.moderation.suspendedUntil).getTime() > Date.now());
};

const buildDecision = ({ allowed = false, reasonCode = 'denied', actor = {}, action = '', resource = {} } = {}) => ({
    allowed: Boolean(allowed),
    reasonCode,
    actorId: normalizeId(actor._id || actor.id || actor.userId),
    action,
    resourceType: normalizeText(resource.type || resource.resourceType),
    resourceId: normalizeId(resource._id || resource.id || resource.resourceId),
});

const authorizeResource = ({
    actor = {},
    action = '',
    resource = {},
    tenantId = '',
    context = {},
} = {}) => {
    const normalizedAction = normalizeText(action);
    const resourceType = normalizeText(resource?.type || resource?.resourceType);
    const actorId = normalizeId(actor._id || actor.id || actor.userId);
    const ownerId = normalizeId(resource?.ownerId || resource?.userId);
    const actorTenantId = normalizeId(actor.tenantId || actor.storeId || actor.sellerId);
    const resourceTenantId = normalizeId(tenantId || resource?.tenantId || resource?.storeId || resource?.sellerId);

    if (!actorId) return buildDecision({ actor, action, resource, reasonCode: 'actor_missing' });
    if (isDisabledActor(actor)) return buildDecision({ actor, action, resource, reasonCode: 'actor_disabled' });
    if (!resource || typeof resource !== 'object' || Object.keys(resource).length === 0) {
        return buildDecision({ actor, action, resource, reasonCode: 'resource_missing' });
    }
    if (!KNOWN_RESOURCE_TYPES.has(resourceType)) {
        return buildDecision({ actor, action, resource, reasonCode: 'unknown_resource_type' });
    }
    if (!KNOWN_ACTION_PREFIXES.some((prefix) => normalizedAction.startsWith(prefix))) {
        return buildDecision({ actor, action, resource, reasonCode: 'unknown_action' });
    }
    if (actorTenantId && resourceTenantId && actorTenantId !== resourceTenantId) {
        return buildDecision({ actor, action, resource, reasonCode: 'tenant_mismatch' });
    }
    if (ownerId && ownerId === actorId) {
        return buildDecision({ allowed: true, actor, action, resource, reasonCode: 'owner_allowed' });
    }
    if (hasRole(actor, 'admin')) {
        if (context.requireStepUp && !context.stepUpSatisfied) {
            return buildDecision({ actor, action, resource, reasonCode: 'admin_step_up_required' });
        }
        return buildDecision({ allowed: true, actor, action, resource, reasonCode: 'admin_allowed' });
    }
    return buildDecision({ actor, action, resource, reasonCode: ownerId ? 'owner_mismatch' : 'owner_missing' });
};

module.exports = {
    KNOWN_ACTION_PREFIXES,
    KNOWN_RESOURCE_TYPES,
    authorizeResource,
};

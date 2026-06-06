const normalizeId = (value = '') => String(value || '').trim();

const getResourceOwnerId = (resource = {}) => normalizeId(
    resource.ownerId
    || resource.userId
    || resource.user
    || resource.sellerId
    || resource.vendorId
);

const actorCanBypassOwnership = ({ actor = {}, policy = {} } = {}) => {
    if (!policy.adminBypassesOwnership) return false;
    return ['admin', 'super_admin'].includes(String(actor.role || '').trim().toLowerCase());
};

const evaluateOwnership = ({ actor = {}, resource = {}, policy = {} } = {}) => {
    if (!policy.requiresOwnership) {
        return {
            ok: true,
            reason: 'OWNERSHIP_NOT_REQUIRED',
        };
    }

    if (!resource) {
        return {
            ok: false,
            reason: 'RESOURCE_NOT_FOUND',
        };
    }

    if (actorCanBypassOwnership({ actor, policy })) {
        return {
            ok: true,
            reason: 'ADMIN_OWNERSHIP_BYPASS',
        };
    }

    const actorId = normalizeId(actor.id || actor._id || actor.userId);
    const ownerId = getResourceOwnerId(resource);
    if (actorId && ownerId && actorId === ownerId) {
        return {
            ok: true,
            reason: 'RESOURCE_OWNER_MATCH',
            ownerId,
        };
    }

    return {
        ok: false,
        reason: 'RESOURCE_OWNERSHIP_MISMATCH',
        ownerId,
        actorId,
    };
};

module.exports = {
    evaluateOwnership,
    getResourceOwnerId,
};

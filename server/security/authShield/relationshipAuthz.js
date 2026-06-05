const { normalizeAction } = require('./types');

const normalizeId = (value = '') => String(value || '').trim();

const hasRole = (identity = {}, role = '') => (
    Array.isArray(identity.roles)
    && identity.roles.map((entry) => String(entry || '').trim().toLowerCase()).includes(String(role || '').trim().toLowerCase())
);

const isSame = (left, right) => Boolean(normalizeId(left) && normalizeId(left) === normalizeId(right));

const can = (identity = {}, action = '', resource = {}, context = {}) => {
    const normalizedAction = normalizeAction(action);
    const userId = normalizeId(identity.userId);

    if (!userId) return { allowed: false, reason: 'identity_missing', relation: '' };
    if ((!resource || typeof resource !== 'object') && context.allowAuthenticatedWithoutResource === true) {
        return { allowed: true, reason: 'authenticated_allowed', relation: 'authenticated' };
    }
    if (!resource || typeof resource !== 'object') return { allowed: false, reason: 'resource_missing', relation: '' };

    if (identity.tenantId && resource.tenantId && normalizeId(identity.tenantId) !== normalizeId(resource.tenantId)) {
        return { allowed: false, reason: 'tenant_mismatch', relation: '' };
    }

    if (normalizedAction.startsWith('payment.refund') && hasRole(identity, 'support') && !identity.hasAdminRole) {
        return { allowed: false, reason: 'support_cannot_refund', relation: 'support' };
    }

    const self = isSame(userId, resource.ownerId) || isSame(userId, resource.userId);
    const buyer = self || isSame(userId, resource.buyerId);
    const seller = isSame(userId, resource.sellerId);
    const admin = Boolean(identity.hasAdminRole || hasRole(identity, 'admin'));

    if (normalizedAction.startsWith('admin.') || normalizedAction.startsWith('security.')) {
        return admin
            ? { allowed: true, reason: 'admin_allowed', relation: 'admin' }
            : { allowed: false, reason: 'admin_required', relation: '' };
    }

    if (normalizedAction.startsWith('auth.')) {
        if (!resource.ownerId || self || admin) {
            return { allowed: true, reason: self ? 'self_allowed' : 'auth_user_allowed', relation: self ? 'self' : 'authenticated' };
        }
        return { allowed: false, reason: 'self_required', relation: '' };
    }

    if (normalizedAction.startsWith('payment.') || resource.type === 'payment' || resource.type === 'refund') {
        if (buyer) return { allowed: true, reason: 'buyer_allowed', relation: 'buyer' };
        if (admin) return { allowed: true, reason: 'admin_allowed', relation: 'admin' };
        return { allowed: false, reason: 'payment_relationship_denied', relation: '' };
    }

    if (normalizedAction.startsWith('order.')) {
        if (buyer) return { allowed: true, reason: 'buyer_allowed', relation: 'buyer' };
        if (seller) return { allowed: true, reason: 'seller_allowed', relation: 'seller' };
        if (admin) return { allowed: true, reason: 'admin_allowed', relation: 'admin' };
        return { allowed: false, reason: 'order_relationship_denied', relation: '' };
    }

    if (normalizedAction.startsWith('listing.')) {
        if (seller || self) return { allowed: true, reason: 'seller_allowed', relation: 'seller' };
        if (admin) return { allowed: true, reason: 'admin_allowed', relation: 'admin' };
        return { allowed: false, reason: 'listing_relationship_denied', relation: '' };
    }

    if (normalizedAction.startsWith('review.') || normalizedAction.startsWith('upload.')) {
        if (self || admin) return { allowed: true, reason: self ? 'owner_allowed' : 'admin_allowed', relation: self ? 'owner' : 'admin' };
        return { allowed: false, reason: 'owner_required', relation: '' };
    }

    if (context.allowAuthenticatedWithoutResource === true) {
        return { allowed: true, reason: 'authenticated_allowed', relation: 'authenticated' };
    }

    if (self) return { allowed: true, reason: 'owner_allowed', relation: 'owner' };
    if (admin) return { allowed: true, reason: 'admin_allowed', relation: 'admin' };
    return { allowed: false, reason: 'relationship_denied', relation: '' };
};

module.exports = {
    can,
    hasRole,
};

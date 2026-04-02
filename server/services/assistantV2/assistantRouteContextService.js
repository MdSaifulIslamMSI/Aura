const { safeString } = require('./assistantContract');

const deriveEntityFromPath = (path = '/') => {
    const normalized = safeString(path || '/');

    if (normalized === '/') {
        return { entityType: 'home', entityId: '' };
    }

    const productMatch = normalized.match(/^\/product\/([^/?#]+)/i);
    if (productMatch?.[1]) {
        return { entityType: 'product', entityId: safeString(productMatch[1]) };
    }

    const categoryMatch = normalized.match(/^\/category\/([^/?#]+)/i);
    if (categoryMatch?.[1]) {
        return { entityType: 'category', entityId: safeString(categoryMatch[1]) };
    }

    if (normalized.startsWith('/cart')) {
        return { entityType: 'cart', entityId: '' };
    }
    if (normalized.startsWith('/checkout')) {
        return { entityType: 'checkout', entityId: '' };
    }
    if (normalized.startsWith('/orders')) {
        return { entityType: 'orders', entityId: '' };
    }
    if (normalized.startsWith('/search')) {
        return { entityType: 'search', entityId: '' };
    }
    if (normalized.startsWith('/assistant')) {
        return { entityType: 'assistant', entityId: '' };
    }

    return { entityType: 'unknown', entityId: '' };
};

const deriveRouteLabel = (path = '/', providedLabel = '') => {
    const label = safeString(providedLabel);
    if (label) return label;

    const normalized = safeString(path || '/');
    if (normalized === '/') return 'Home feed';
    if (normalized.startsWith('/product/')) return 'Product detail';
    if (normalized.startsWith('/category/')) return 'Category browse';
    if (normalized.startsWith('/cart')) return 'Cart';
    if (normalized.startsWith('/checkout')) return 'Checkout';
    if (normalized.startsWith('/orders')) return 'Orders';
    if (normalized.startsWith('/search')) return 'Search';
    if (normalized.startsWith('/assistant')) return 'Assistant workspace';
    return 'Shopping flow';
};

const assembleRouteContext = (routeContext = {}) => {
    const path = safeString(routeContext?.path || '/');
    const derivedEntity = deriveEntityFromPath(path);

    return {
        path,
        label: deriveRouteLabel(path, routeContext?.label),
        entityType: safeString(routeContext?.entityType || derivedEntity.entityType || 'unknown'),
        entityId: safeString(routeContext?.entityId || derivedEntity.entityId || ''),
    };
};

module.exports = {
    assembleRouteContext,
};

export const safeString = (value = '') => String(value ?? '').trim();

export const createMessageId = (prefix = 'assistant') => (
    `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
);

export const deriveOriginContext = (fromPath = '/') => {
    const normalizedPath = safeString(fromPath || '/');
    const productMatch = normalizedPath.match(/^\/product\/([^/?#]+)/i);
    const categoryMatch = normalizedPath.match(/^\/category\/([^/?#]+)/i);

    if (normalizedPath === '/') {
        return { path: normalizedPath, label: 'Home feed', entityType: 'home', entityId: '' };
    }
    if (productMatch?.[1]) {
        return { path: normalizedPath, label: 'Product detail', entityType: 'product', entityId: safeString(productMatch[1]) };
    }
    if (categoryMatch?.[1]) {
        return { path: normalizedPath, label: 'Category browse', entityType: 'category', entityId: safeString(categoryMatch[1]) };
    }
    if (normalizedPath.startsWith('/cart')) {
        return { path: normalizedPath, label: 'Cart', entityType: 'cart', entityId: '' };
    }
    if (normalizedPath.startsWith('/checkout')) {
        return { path: normalizedPath, label: 'Checkout', entityType: 'checkout', entityId: '' };
    }
    if (normalizedPath.startsWith('/orders')) {
        return { path: normalizedPath, label: 'Orders', entityType: 'orders', entityId: '' };
    }
    if (normalizedPath.startsWith('/search')) {
        return { path: normalizedPath, label: 'Search', entityType: 'search', entityId: '' };
    }
    return { path: normalizedPath || '/', label: 'Shopping flow', entityType: 'unknown', entityId: '' };
};

export const createAssistantMessage = ({
    text = '',
    cards = [],
    actions = [],
    supportDraft = null,
    telemetry = null,
    role = 'assistant',
    decision = null,
    provisional = false,
    traceId = '',
    decisionId = '',
    upgradeEligible = false,
} = {}) => ({
    id: createMessageId(role),
    role,
    text,
    cards,
    actions,
    supportDraft,
    telemetry,
    decision,
    provisional,
    traceId,
    decisionId,
    upgradeEligible,
    createdAt: Date.now(),
});

export const createWelcomeMessage = (originContext) => createAssistantMessage({
    text: `You launched from ${originContext.label}. Ask for a tighter search, a side-by-side compare, a cart review, or a clean support handoff.`,
});

export const extractCandidateProductIds = (messages = [], originProductId = '') => {
    const ids = messages.flatMap((message) => (
        Array.isArray(message.cards)
            ? message.cards.flatMap((card) => {
                if (card?.type === 'product' && card?.product?.id) return [card.product.id];
                if (card?.type === 'comparison' && Array.isArray(card.products)) {
                    return card.products.map((product) => safeString(product?.id || ''));
                }
                return [];
            })
            : []
    ));

    if (originProductId) {
        ids.unshift(originProductId);
    }

    return [...new Set(ids.map((entry) => safeString(entry)).filter(Boolean))].slice(0, 8);
};

export const formatMoney = (value = 0, currency = 'INR') => {
    const numeric = Number(value || 0);
    return `${currency} ${numeric.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
};

const ACTION_TYPES = Object.freeze([
    'open_product',
    'open_category',
    'open_cart',
    'add_to_cart',
    'open_checkout',
    'open_support',
    'search_products',
    'select_product',
    'remove_from_cart',
    'go_to_checkout',
    'track_order',
    'navigate_to',
]);

const CARD_TYPES = Object.freeze([
    'product',
    'comparison',
    'cart_summary',
    'empty_state',
]);

const INTENTS = Object.freeze([
    'general_help',
    'product_search',
    'comparison',
    'cart_review',
    'checkout',
    'support_handoff',
    'product_focus',
    'general_knowledge',
    'product_selection',
    'cart_action',
    'navigation',
    'support',
]);

const safeString = (value, fallback = '') => String(value === undefined || value === null ? fallback : value).trim();
const clamp = (value, min, max) => Math.min(Math.max(Number(value) || 0, min), max);

const slugify = (value = '') => safeString(value)
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

const normalizeIntent = (value, fallback = 'general_help') => {
    const normalized = safeString(value, fallback);
    return INTENTS.includes(normalized) ? normalized : fallback;
};

const normalizeAction = (action = {}) => {
    const type = safeString(action?.type || '');
    if (!ACTION_TYPES.includes(type)) return null;

    return {
        type,
        label: safeString(action?.label || ''),
        productId: safeString(action?.productId || ''),
        category: safeString(action?.category || ''),
        path: safeString(action?.path || ''),
        quantity: Math.max(1, Number(action?.quantity || 1)),
        query: safeString(action?.query || ''),
        filters: action?.filters && typeof action.filters === 'object'
            ? {
                category: safeString(action.filters.category || ''),
                priceMin: Math.max(0, Number(action.filters.priceMin || 0)),
                priceMax: Math.max(0, Number(action.filters.priceMax || 0)),
            }
            : {},
        page: safeString(action?.page || ''),
        params: action?.params && typeof action.params === 'object' ? action.params : {},
        orderId: safeString(action?.orderId || ''),
        prefill: action?.prefill && typeof action.prefill === 'object' ? action.prefill : null,
        requiresConfirmation: Boolean(action?.requiresConfirmation),
        reason: safeString(action?.reason || ''),
    };
};

const normalizeProductSummary = (product = {}) => ({
    id: safeString(product?.id || product?._id || product?.externalId || ''),
    title: safeString(product?.displayTitle || product?.title || product?.name || 'Untitled product'),
    brand: safeString(product?.brand || ''),
    category: safeString(product?.category || ''),
    price: Math.max(0, Number(product?.price || 0)),
    originalPrice: Math.max(0, Number(product?.originalPrice || product?.price || 0)),
    discountPercentage: Math.max(0, Number(product?.discountPercentage || 0)),
    image: safeString(product?.image || product?.thumbnail || ''),
    rating: clamp(product?.rating || 0, 0, 5),
    ratingCount: Math.max(0, Number(product?.ratingCount || 0)),
    deliveryTime: safeString(product?.deliveryTime || ''),
    stock: Math.max(0, Number(product?.stock || 0)),
});

const normalizeCard = (card = {}) => {
    const type = safeString(card?.type || '');
    if (!CARD_TYPES.includes(type)) return null;

    if (type === 'product') {
        return {
            type,
            id: safeString(card?.id || `product:${safeString(card?.product?.id || '')}`),
            title: safeString(card?.title || ''),
            description: safeString(card?.description || ''),
            product: normalizeProductSummary(card?.product || {}),
        };
    }

    if (type === 'comparison') {
        return {
            type,
            id: safeString(card?.id || 'comparison'),
            title: safeString(card?.title || ''),
            description: safeString(card?.description || ''),
            products: (Array.isArray(card?.products) ? card.products : [])
                .map((product) => normalizeProductSummary(product))
                .filter((product) => product.id)
                .slice(0, 4),
        };
    }

    if (type === 'cart_summary') {
        return {
            type,
            id: safeString(card?.id || 'cart-summary'),
            title: safeString(card?.title || ''),
            description: safeString(card?.description || ''),
            cartSummary: {
                totalPrice: Math.max(0, Number(card?.cartSummary?.totalPrice || 0)),
                totalOriginalPrice: Math.max(0, Number(card?.cartSummary?.totalOriginalPrice || 0)),
                totalDiscount: Math.max(0, Number(card?.cartSummary?.totalDiscount || 0)),
                totalItems: Math.max(0, Number(card?.cartSummary?.totalItems || 0)),
                itemCount: Math.max(0, Number(card?.cartSummary?.itemCount || 0)),
                currency: safeString(card?.cartSummary?.currency || 'INR'),
            },
        };
    }

    return {
        type,
        id: safeString(card?.id || 'empty-state'),
        title: safeString(card?.title || ''),
        description: safeString(card?.description || ''),
    };
};

const normalizeSupportDraft = (draft = null) => {
    if (!draft || typeof draft !== 'object') return null;
    return {
        category: safeString(draft.category || 'general'),
        subject: safeString(draft.subject || ''),
        body: safeString(draft.body || ''),
        relatedOrderId: safeString(draft.relatedOrderId || ''),
    };
};

const createSessionPayload = (session = {}) => ({
    id: safeString(session?.id || ''),
    expiresAt: safeString(session?.expiresAt || ''),
});

module.exports = {
    ACTION_TYPES,
    CARD_TYPES,
    INTENTS,
    clamp,
    createSessionPayload,
    normalizeAction,
    normalizeCard,
    normalizeIntent,
    normalizeProductSummary,
    normalizeSupportDraft,
    safeString,
    slugify,
};

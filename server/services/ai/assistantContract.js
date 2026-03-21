const crypto = require('crypto');

const INTENTS = Object.freeze([
    'general_knowledge',
    'product_search',
    'product_selection',
    'cart_action',
    'checkout',
    'navigation',
    'support',
]);

const DECISIONS = Object.freeze(['respond', 'act', 'clarify']);

const ASSISTANT_ACTION_TYPES = Object.freeze([
    'search_products',
    'select_product',
    'add_to_cart',
    'remove_from_cart',
    'go_to_checkout',
    'track_order',
    'navigate_to',
    'open_support',
]);

const UI_SURFACES = Object.freeze([
    'plain_answer',
    'product_results',
    'product_focus',
    'cart_summary',
    'confirmation_card',
    'navigation_notice',
    'support_handoff',
]);

const safeString = (value, fallback = '') => String(value === undefined || value === null ? fallback : value).trim();
const clamp = (value, min, max) => Math.min(Math.max(Number(value) || 0, min), max);

const normalizeIntent = (value, fallback = 'general_knowledge') => {
    const normalized = safeString(value, fallback);
    return INTENTS.includes(normalized) ? normalized : fallback;
};

const normalizeDecision = (value, fallback = 'respond') => {
    const normalized = safeString(value, fallback);
    return DECISIONS.includes(normalized) ? normalized : fallback;
};

const normalizeActionType = (value, fallback = '') => {
    const normalized = safeString(value, fallback);
    return ASSISTANT_ACTION_TYPES.includes(normalized) ? normalized : fallback;
};

const normalizeUiSurface = (value, fallback = 'plain_answer') => {
    const normalized = safeString(value, fallback);
    return UI_SURFACES.includes(normalized) ? normalized : fallback;
};

const normalizeEntities = (entities = {}) => {
    const productIds = Array.isArray(entities?.productIds)
        ? entities.productIds.map((entry) => safeString(entry)).filter(Boolean).slice(0, 8)
        : [];

    return {
        query: safeString(entities?.query || ''),
        productId: safeString(entities?.productId || ''),
        productIds,
        quantity: Math.max(0, Number(entities?.quantity) || 0),
        priceMin: Math.max(0, Number(entities?.priceMin) || 0),
        priceMax: Math.max(0, Number(entities?.priceMax) || 0),
        category: safeString(entities?.category || ''),
        page: safeString(entities?.page || ''),
        orderId: safeString(entities?.orderId || ''),
        supportCategory: safeString(entities?.supportCategory || ''),
        operation: safeString(entities?.operation || ''),
        compareTerms: Array.isArray(entities?.compareTerms)
            ? entities.compareTerms.map((entry) => safeString(entry)).filter(Boolean).slice(0, 4)
            : [],
    };
};

const normalizeAction = (action = {}) => {
    const type = normalizeActionType(action?.type);
    if (!type) return null;

    return {
        type,
        productId: safeString(action?.productId || ''),
        quantity: Math.max(0, Number(action?.quantity) || 0),
        query: safeString(action?.query || ''),
        filters: action?.filters && typeof action.filters === 'object' ? {
            category: safeString(action.filters.category || ''),
            priceMin: Math.max(0, Number(action.filters.priceMin) || 0),
            priceMax: Math.max(0, Number(action.filters.priceMax) || 0),
        } : {},
        page: safeString(action?.page || ''),
        params: action?.params && typeof action.params === 'object' ? action.params : {},
        orderId: safeString(action?.orderId || ''),
        prefill: action?.prefill && typeof action.prefill === 'object' ? action.prefill : null,
        requiresConfirmation: Boolean(action?.requiresConfirmation),
        reason: safeString(action?.reason || ''),
    };
};

const normalizeActions = (actions = []) => (
    (Array.isArray(actions) ? actions : [])
        .map((entry) => normalizeAction(entry))
        .filter(Boolean)
        .slice(0, 6)
);

const buildConfirmationToken = (action = {}) => crypto
    .createHash('sha256')
    .update(JSON.stringify({
        type: safeString(action?.type || ''),
        productId: safeString(action?.productId || ''),
        query: safeString(action?.query || ''),
        page: safeString(action?.page || ''),
        orderId: safeString(action?.orderId || ''),
        quantity: Math.max(0, Number(action?.quantity) || 0),
    }))
    .digest('hex')
    .slice(0, 16);

const buildAssistantTurn = ({
    intent = 'general_knowledge',
    entities = {},
    confidence = 0,
    decision = 'respond',
    response = '',
    actions = [],
    ui = {},
    contextPatch = {},
    followUps = [],
    safetyFlags = [],
} = {}) => ({
    intent: normalizeIntent(intent),
    entities: normalizeEntities(entities),
    confidence: clamp(confidence, 0, 1),
    decision: normalizeDecision(decision),
    response: safeString(response),
    actions: normalizeActions(actions),
    ui: {
        surface: normalizeUiSurface(ui?.surface || 'plain_answer'),
        title: safeString(ui?.title || ''),
        products: Array.isArray(ui?.products) ? ui.products : [],
        product: ui?.product && typeof ui.product === 'object' ? ui.product : null,
        cartSummary: ui?.cartSummary && typeof ui.cartSummary === 'object' ? ui.cartSummary : null,
        confirmation: ui?.confirmation && typeof ui.confirmation === 'object'
            ? {
                token: safeString(ui.confirmation.token || ''),
                message: safeString(ui.confirmation.message || ''),
                action: normalizeAction(ui.confirmation.action || {}) || null,
            }
            : null,
        navigation: ui?.navigation && typeof ui.navigation === 'object'
            ? {
                page: safeString(ui.navigation.page || ''),
                path: safeString(ui.navigation.path || ''),
                params: ui.navigation.params && typeof ui.navigation.params === 'object' ? ui.navigation.params : {},
            }
            : null,
        support: ui?.support && typeof ui.support === 'object'
            ? {
                orderId: safeString(ui.support.orderId || ''),
                prefill: ui.support.prefill && typeof ui.support.prefill === 'object' ? ui.support.prefill : null,
            }
            : null,
    },
    contextPatch: contextPatch && typeof contextPatch === 'object' ? contextPatch : {},
    followUps: Array.isArray(followUps)
        ? followUps.map((entry) => safeString(entry)).filter(Boolean).slice(0, 4)
        : [],
    safetyFlags: Array.isArray(safetyFlags)
        ? safetyFlags.map((entry) => safeString(entry)).filter(Boolean).slice(0, 6)
        : [],
});

module.exports = {
    ASSISTANT_ACTION_TYPES,
    DECISIONS,
    INTENTS,
    UI_SURFACES,
    buildAssistantTurn,
    buildConfirmationToken,
    normalizeAction,
    normalizeActions,
    normalizeDecision,
    normalizeEntities,
    normalizeIntent,
    safeString,
};

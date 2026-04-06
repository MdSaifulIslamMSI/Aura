import { parseClientAssistantIntent } from './assistantIntent';

const ROUTE_LABELS = [
    { match: (pathname = '/') => pathname === '/', label: 'Home' },
    { match: (pathname = '/') => pathname.startsWith('/products') || pathname.startsWith('/category') || pathname.startsWith('/search'), label: 'Catalog' },
    { match: (pathname = '/') => pathname.startsWith('/product/'), label: 'Product' },
    { match: (pathname = '/') => pathname.startsWith('/marketplace'), label: 'Marketplace' },
    { match: (pathname = '/') => pathname.startsWith('/listing/'), label: 'Listing' },
    { match: (pathname = '/') => pathname.startsWith('/cart'), label: 'Cart' },
];

const SUPPORT_CATEGORY_RULES = [
    { pattern: /\b(return|refund|replacement|replace|exchange|damaged|defect)\b/i, category: 'returns' },
    { pattern: /\b(order|track|tracking|delivery|shipment|late|delay|delayed|cancel order|order issue)\b/i, category: 'orders' },
    { pattern: /\b(payment|billing|upi|card|transaction|emi|invoice)\b/i, category: 'payments' },
    { pattern: /\b(login|account|profile|password|security)\b/i, category: 'account' },
];

const HELP_PATTERN = /^(?:help|what can you do|how does this work)\??$/i;
const CART_PATTERN = /^(?:cart|bag|basket|open cart|view cart|show cart|take me to cart)$/i;
const CHECKOUT_PATTERN = /\b(checkout|pay now|place order)\b/i;
const SUPPORT_PATTERN = /\b(support|help with|track my order|refund|return|replace|cancel order|issue|problem|payment failed|complaint)\b/i;
const SEARCH_PATTERN = /^\s*(?:search(?:\s+for)?|find|look\s+for|show\s+me|need|want)\s+(.+)$/i;
const PRODUCT_PATTERN = /\b(?:open|show|view)\s+(?:product|item)\s+(\d+)\b/i;
const COMPARE_PATTERN = /\b(compare|vs|versus|better between)\b/i;
const BUNDLE_PATTERN = /\b(bundle|setup|kit)\b/i;
const BUDGET_PATTERN = /\b(budget|under|below|within|max)\b/i;

const safeString = (value = '') => String(value ?? '').trim();

const normalizeText = (value = '') => safeString(value)
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const toTitleCase = (value = '') => safeString(value)
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\w/, (letter) => letter.toUpperCase());

const formatInr = (value = 0) => `Rs ${Number(value || 0).toLocaleString('en-IN')}`;

const buildActionId = (kind = 'action', payload = {}) => `${kind}:${JSON.stringify(payload)}`;
const QUESTION_SUGGESTION_PATTERN = /\?\s*$/;

export const createChatAction = (kind, label, payload = {}, tone = 'secondary') => ({
    id: buildActionId(kind, payload),
    kind,
    label,
    payload,
    tone,
});

export const dedupeActions = (actions = []) => {
    const seen = new Set();
    return (Array.isArray(actions) ? actions : []).filter((action) => {
        if (!action?.id || seen.has(action.id)) return false;
        seen.add(action.id);
        return true;
    });
};

export const capVisibleActions = (actions = [], limit = 3) => dedupeActions(actions).slice(0, Math.max(0, limit));

export const summarizeCartItems = (items = []) => (Array.isArray(items) ? items : []).reduce((summary, item) => {
    const price = Number(item?.price || 0);
    const originalPrice = Number(item?.originalPrice || price);
    const quantity = Math.max(1, Number(item?.quantity || 1));

    summary.totalItems += quantity;
    summary.itemCount += 1;
    summary.totalPrice += price * quantity;
    summary.totalOriginalPrice += originalPrice * quantity;
    summary.totalDiscount += Math.max(0, (originalPrice - price) * quantity);
    return summary;
}, {
    totalItems: 0,
    itemCount: 0,
    totalPrice: 0,
    totalOriginalPrice: 0,
    totalDiscount: 0,
});

export const normalizeProductSummary = (product = {}) => ({
    id: safeString(product?.id || product?._id || ''),
    title: safeString(product?.displayTitle || product?.title || product?.name || 'Untitled product'),
    brand: safeString(product?.brand || ''),
    price: Number(product?.price || 0),
    originalPrice: Number(product?.originalPrice || product?.price || 0),
    discountPercentage: Number(product?.discountPercentage || 0),
    image: safeString(product?.image || product?.thumbnail || ''),
    stock: Math.max(0, Number(product?.stock || 0)),
    rating: Number(product?.rating || 0),
    ratingCount: Number(product?.ratingCount || 0),
    category: safeString(product?.category || ''),
});

export const getAssistantRouteLabel = (pathname = '/') => {
    const matched = ROUTE_LABELS.find((entry) => entry.match(pathname));
    return matched?.label || 'Store';
};

export const extractBudgetFromText = (rawText = '', fallback = 0) => {
    const match = safeString(rawText).match(/(?:budget|under|below|max|within)\s*(?:rs|inr)?\s*([\d,]+)/i);
    if (!match?.[1]) return fallback;
    const parsed = Number(match[1].replace(/,/g, ''));
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

export const inferBundleTheme = (rawText = '', pathname = '/') => {
    const normalized = normalizeText(rawText);
    if (/\bgaming|console|stream\b/.test(normalized)) return 'gaming setup';
    if (/\bwork|office|desk|remote\b/.test(normalized)) return 'workstation';
    if (/\btravel|camera|creator|content\b/.test(normalized)) return 'creator kit';
    if (pathname.startsWith('/marketplace')) return 'marketplace picks';
    if (pathname.startsWith('/product/')) return 'upgrade path';
    return 'smart essentials';
};

export const buildSupportPrefill = (rawText = '', options = {}) => {
    const safeIntent = safeString(rawText);
    const category = SUPPORT_CATEGORY_RULES.find((rule) => rule.pattern.test(safeIntent))?.category || 'general';
    const subjectCore = toTitleCase(safeIntent).slice(0, 72) || 'Support request';

    return {
        category,
        subject: `Support: ${subjectCore}`,
        intent: safeIntent,
        actionId: safeString(options?.actionId || options?.activeProductId || ''),
    };
};

export const buildSupportHandoffPath = (prefill = {}) => {
    const params = new URLSearchParams();
    params.set('compose', '1');

    if (safeString(prefill?.category)) params.set('category', safeString(prefill.category));
    if (safeString(prefill?.subject)) params.set('subject', safeString(prefill.subject));
    if (safeString(prefill?.intent)) params.set('intent', safeString(prefill.intent));
    if (safeString(prefill?.actionId)) params.set('actionId', safeString(prefill.actionId));

    return `/contact?${params.toString()}`;
};

export const parseAssistantCommand = (rawText = '') => {
    const raw = safeString(rawText);
    if (!raw) return { type: 'empty' };

    if (HELP_PATTERN.test(raw)) {
        return { type: 'help' };
    }

    if (CART_PATTERN.test(raw)) {
        return { type: 'cart' };
    }

    if (CHECKOUT_PATTERN.test(raw)) {
        return { type: 'checkout' };
    }

    if (SUPPORT_PATTERN.test(raw)) {
        return { type: 'support' };
    }

    const productMatch = raw.match(PRODUCT_PATTERN);
    if (productMatch?.[1]) {
        return {
            type: 'product',
            productId: productMatch[1],
        };
    }

    const searchMatch = raw.match(SEARCH_PATTERN);
    if (searchMatch?.[1]) {
        return {
            type: 'search',
            query: safeString(searchMatch[1]),
        };
    }

    return {
        type: 'chat',
        message: raw,
    };
};

export const deriveAssistantMode = ({
    message = '',
    candidateProductIds = [],
} = {}) => {
    const safeMessage = safeString(message);
    if (!safeMessage) return 'chat';
    const parsedIntent = parseClientAssistantIntent(safeMessage);

    const uniqueIds = [...new Set((Array.isArray(candidateProductIds) ? candidateProductIds : []).map((id) => safeString(id)).filter(Boolean))];
    if (COMPARE_PATTERN.test(safeMessage) && uniqueIds.length >= 2) {
        return 'compare';
    }

    if (BUNDLE_PATTERN.test(safeMessage) || (BUDGET_PATTERN.test(safeMessage) && parsedIntent.intent === 'product_search')) {
        return 'bundle';
    }

    return 'chat';
};

export const buildAssistantRequestPayload = ({
    message = '',
    pathname = '/',
    candidateProductIds = [],
    latestProducts = [],
    cartItems = [],
    wishlistItems = [],
    activeProductId = null,
} = {}) => {
    const normalizedProducts = (Array.isArray(latestProducts) ? latestProducts : [])
        .map((product) => normalizeProductSummary(product))
        .filter((product) => safeString(product.id))
        .slice(0, 3);

    const resolvedProductIds = [
        ...new Set([
            ...(Array.isArray(candidateProductIds) ? candidateProductIds : []),
            ...normalizedProducts.map((product) => product.id),
            safeString(activeProductId),
        ].map((id) => safeString(id)).filter(Boolean)),
    ].slice(0, 4);

    return {
        assistantMode: deriveAssistantMode({
            message,
            candidateProductIds: resolvedProductIds,
        }),
        context: {
            route: pathname,
            routeLabel: getAssistantRouteLabel(pathname),
            intentHint: parseClientAssistantIntent(message).intent,
            theme: inferBundleTheme(message, pathname),
            budget: extractBudgetFromText(message),
            maxItems: 3,
            productIds: resolvedProductIds,
            recommendationSignals: {
                recentlyViewed: normalizedProducts.map((product) => ({
                    id: product.id,
                    category: product.category,
                    brand: product.brand,
                })),
                searchHistory: [safeString(message)].filter(Boolean),
                cartItems: Array.isArray(cartItems) ? cartItems.length : 0,
                wishlistItems: Array.isArray(wishlistItems) ? wishlistItems.length : 0,
            },
        },
    };
};

export const normalizeBackendActions = (actions = []) => capVisibleActions((Array.isArray(actions) ? actions : []).flatMap((action) => {
    if (!action?.type) return [];

    switch (action.type) {
        case 'search':
            return safeString(action.query)
                ? [createChatAction('search', 'Refine search', { query: safeString(action.query) })]
                : [];
        case 'open_product':
            return safeString(action.productId)
                ? [createChatAction('view-details', 'View details', { id: safeString(action.productId) })]
                : [];
        case 'navigate':
            if (String(action.path || '').startsWith('/checkout')) {
                return [createChatAction('go-checkout', 'Go to checkout', {})];
            }
            if (String(action.path || '').startsWith('/cart')) {
                return [createChatAction('view-cart', 'View cart', {})];
            }
            if (String(action.path || '').startsWith('/product/')) {
                const productId = safeString(String(action.path).split('/product/')[1]);
                return productId
                    ? [createChatAction('view-details', 'View details', { id: productId })]
                    : [];
            }
            return [];
        default:
            return [];
    }
}));

export const buildSuggestionActions = (suggestions = []) => capVisibleActions((Array.isArray(suggestions) ? suggestions : [])
    .map((suggestion) => safeString(suggestion))
    .filter(Boolean)
    .flatMap((suggestion) => {
        if (QUESTION_SUGGESTION_PATTERN.test(suggestion)) {
            return [];
        }

        const parsed = parseClientAssistantIntent(suggestion);

        if (parsed.intent === 'checkout') {
            return [createChatAction('prepare-checkout', suggestion, {})];
        }

        if (parsed.intent === 'support') {
            return [createChatAction('handoff-support', suggestion, {})];
        }

        if (parsed.intent === 'navigation' && parsed.entities?.page === 'cart') {
            return [createChatAction('view-cart', suggestion, {})];
        }

        if (parsed.intent === 'navigation' && parsed.entities?.page) {
            return [createChatAction('navigate', suggestion, {
                page: parsed.entities.page,
                path: parsed.action?.path || '',
                label: parsed.action?.label || suggestion,
                params: parsed.action?.params || {},
            })];
        }

        if (parsed.intent === 'product_search' && parsed.entities?.query) {
            return [createChatAction('search', suggestion, { query: parsed.entities.query })];
        }

        return [createChatAction('search', suggestion, { query: suggestion })];
    }));

export const buildModeActions = ({
    mode = 'explore',
    products = [],
    cartCount = 0,
    lastQuery = '',
    supportPrefill = null,
    externalActions = [],
} = {}) => {
    const safeProducts = (Array.isArray(products) ? products : [])
        .map((product) => normalizeProductSummary(product))
        .filter((product) => safeString(product.id));
    const defaultActions = [];
    let primaryAction = null;

    switch (mode) {
        case 'product':
            if (safeProducts[0]) {
                primaryAction = createChatAction('add-to-cart', 'Add to cart', { id: safeProducts[0].id }, 'primary');
                defaultActions.push(createChatAction('view-details', 'View details', { id: safeProducts[0].id }));
            }
            if (cartCount > 0) {
                defaultActions.push(createChatAction('view-cart', 'View cart', {}));
            }
            break;
        case 'cart':
            if (cartCount > 0) {
                primaryAction = createChatAction('prepare-checkout', 'Checkout', {}, 'primary');
                defaultActions.push(createChatAction('edit-cart', 'Edit cart', {}));
            }
            if (safeString(lastQuery)) {
                defaultActions.push(createChatAction('continue-shopping', 'Continue shopping', { query: safeString(lastQuery) }));
            }
            break;
        case 'checkout':
            if (cartCount > 0) {
                primaryAction = createChatAction('go-checkout', 'Go to checkout', {}, 'primary');
            }
            defaultActions.push(createChatAction('view-cart', 'View cart', {}));
            break;
        case 'support':
            primaryAction = createChatAction('handoff-support', 'Open support desk', { prefill: supportPrefill || {} }, 'primary');
            if (safeString(lastQuery)) {
                defaultActions.push(createChatAction('continue-shopping', 'Back to shopping', { query: safeString(lastQuery) }));
            }
            break;
        default:
            if (safeString(lastQuery)) {
                defaultActions.push(createChatAction('search', 'Refine search', { query: safeString(lastQuery) }));
            } else {
                defaultActions.push(createChatAction('search', 'Top deals', { query: 'Show the best deals today' }));
            }

            if (cartCount > 0) {
                defaultActions.push(createChatAction('view-cart', 'View cart', {}));
            }
            break;
    }

    const mergedActions = capVisibleActions(
        dedupeActions([...(Array.isArray(externalActions) ? externalActions : []), ...defaultActions])
            .filter((action) => action?.id && action.id !== primaryAction?.id),
        primaryAction ? 2 : 3
    );

    return {
        primaryAction,
        secondaryActions: mergedActions,
    };
};

export const deriveResponseMode = ({
    pathname = '/',
    products = [],
    requestedMode = 'explore',
} = {}) => {
    if (pathname.startsWith('/cart')) {
        return 'cart';
    }

    const safeProducts = (Array.isArray(products) ? products : []).filter((product) => safeString(product?.id || product?._id));
    if (safeProducts.length === 1) {
        return 'product';
    }

    if (requestedMode === 'support' || requestedMode === 'checkout') {
        return requestedMode;
    }

    return 'explore';
};

export const buildLocalAssistantResponse = (rawText = '', options = {}) => {
    const command = parseAssistantCommand(rawText);
    const cartCount = Number(options?.cartCount || 0);
    const cartSummary = options?.cartSummary || summarizeCartItems(options?.cartItems || []);
    const activeProductId = safeString(options?.activeProductId || '');

    switch (command.type) {
        case 'help': {
            const actions = buildModeActions({
                mode: 'explore',
                cartCount,
                externalActions: buildSuggestionActions([
                    'Show the best deals today',
                    'Find phones under Rs 30000',
                ]),
            });

            return {
                local: true,
                answer: 'Ask for a product, a budget, or help with an order. I will keep one next step in focus.',
                mode: 'explore',
                ...actions,
            };
        }
        case 'cart': {
            const actions = buildModeActions({
                mode: 'cart',
                cartCount,
                lastQuery: options?.lastQuery || '',
            });

            return {
                local: true,
                answer: cartCount > 0
                    ? `Your cart is ready with ${cartSummary.totalItems} item${cartSummary.totalItems === 1 ? '' : 's'} worth ${formatInr(cartSummary.totalPrice)}.`
                    : 'Your cart is empty right now. Search for a product and I will keep the next decision tight.',
                mode: 'cart',
                cartSummary,
                ...actions,
            };
        }
        case 'checkout': {
            const actions = buildModeActions({
                mode: 'checkout',
                cartCount,
            });

            return {
                local: true,
                answer: cartCount > 0
                    ? 'Checkout is the next step. I will keep the handoff clean so nothing competes with the purchase.'
                    : 'Add at least one item before moving to checkout.',
                mode: 'checkout',
                cartSummary,
                ...actions,
            };
        }
        case 'support': {
            const supportPrefill = buildSupportPrefill(rawText, { activeProductId });
            const actions = buildModeActions({
                mode: 'support',
                cartCount,
                lastQuery: options?.lastQuery || '',
                supportPrefill,
            });

            return {
                local: true,
                answer: 'Support works best in the dedicated support desk. I can hand this off with the context prefilled.',
                mode: 'support',
                supportPrefill,
                ...actions,
            };
        }
        case 'product': {
            const actions = {
                primaryAction: null,
                secondaryActions: [
                    createChatAction('view-details', 'View details', { id: safeString(command.productId) }),
                ],
            };

            return {
                local: true,
                answer: 'I found that product reference. Open the full detail page to continue the decision.',
                mode: 'product',
                ...actions,
                activeProductId: safeString(command.productId),
            };
        }
        case 'search':
            return {
                local: false,
                query: command.query,
            };
        default:
            return null;
    }
};

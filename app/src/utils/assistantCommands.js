import { parseClientAssistantIntent } from './assistantIntent';
import assistantCapabilities from '../../../shared/assistantCapabilities.json';

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

const HELP_PATTERN = /^(?:help|what can (?:i|you) do(?: here)?|how does this work)\??$/i;
const CART_PATTERN = /^(?:cart|bag|basket|open cart|view cart|show cart|take me to cart)$/i;
const CHECKOUT_PATTERN = /\b(checkout|pay now|place order)\b/i;
const SUPPORT_PATTERN = /\b(support|help with|track my order|where is my order|order status|delivery status|refund|return|replace|cancel order|issue|problem|payment failed|complaint)\b/i;
const SEARCH_PATTERN = /^\s*(?:search(?:\s+for)?|find|look\s+for|show\s+me|need|want)\s+(.+)$/i;
const PRODUCT_PATTERN = /\b(?:open|show|view)\s+(?:product|item)\s+(\d+)\b/i;
const COMPARE_PATTERN = /\b(compare|vs|versus|better between)\b/i;
const BUNDLE_PATTERN = /\b(bundle|setup|kit)\b/i;
const BUDGET_PATTERN = /\b(budget|under|below|within|max)\b/i;

const safeString = (value = '') => String(value ?? '').trim();

const normalizeCapabilityText = (value = '') => safeString(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

export const APP_ASSISTANT_CAPABILITIES = Object.freeze(
    (Array.isArray(assistantCapabilities) ? assistantCapabilities : []).map((capability) => ({
        ...capability,
        aliases: Array.isArray(capability?.aliases) ? capability.aliases.map((alias) => safeString(alias)).filter(Boolean) : [],
        contextRequired: Array.isArray(capability?.contextRequired) ? capability.contextRequired.map((entry) => safeString(entry)).filter(Boolean) : [],
    }))
);

const capabilityAliasMatches = (normalizedText = '', alias = '') => {
    const normalizedAlias = normalizeCapabilityText(alias);
    if (!normalizedText || !normalizedAlias) return false;
    return ` ${normalizedText} `.includes(` ${normalizedAlias} `);
};

export const findAppAssistantCapability = (rawText = '') => {
    const normalizedText = normalizeCapabilityText(rawText);
    if (!normalizedText) return null;

    return APP_ASSISTANT_CAPABILITIES
        .flatMap((capability) => capability.aliases.map((alias) => ({ capability, alias })))
        .sort((left, right) => normalizeCapabilityText(right.alias).length - normalizeCapabilityText(left.alias).length)
        .find((entry) => capabilityAliasMatches(normalizedText, entry.alias))
        ?.capability || null;
};

const routeMatchesCapability = (pathname = '/', route = '/') => {
    const normalizedPath = safeString(pathname).split('?')[0].split('#')[0] || '/';
    const routePath = safeString(route).split('?')[0] || '/';
    if (routePath === '/') return normalizedPath === '/';
    const routePattern = routePath
        .split('/')
        .map((segment) => (segment.startsWith(':') ? '[^/]+' : segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
        .join('/');
    return new RegExp(`^${routePattern}(?:/|$)`, 'i').test(normalizedPath);
};

const findCapabilityForPath = (pathname = '/') => (
    APP_ASSISTANT_CAPABILITIES.find((capability) => routeMatchesCapability(pathname, capability.route)) || null
);

const buildCapabilityAction = (capability = {}, params = {}) => createChatAction(
    'navigate',
    `Open ${safeString(capability?.title || 'page')}`,
    {
        page: safeString(capability?.id || 'home'),
        params,
    },
    'primary',
);

const buildCapabilityRequirementText = (capability = {}, options = {}) => {
    const requirements = [];
    if (capability?.authRequired && options?.isAuthenticated !== true) {
        requirements.push('Sign-in is required');
    }
    if (safeString(capability?.roleRequired)) {
        requirements.push(`${safeString(capability.roleRequired)} access is required`);
    }
    if (Array.isArray(capability?.contextRequired) && capability.contextRequired.length > 0) {
        requirements.push(`Needs ${capability.contextRequired.join(' and ')}`);
    }
    return requirements.length > 0 ? ` ${requirements.join('. ')}.` : '';
};

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
    deliveryTime: safeString(product?.deliveryTime || ''),
    warranty: safeString(product?.warranty || ''),
    category: safeString(product?.category || ''),
    assistantRank: Math.max(0, Number(product?.assistantRank || 0)),
    assistantReason: safeString(product?.assistantReason || product?.reason || ''),
    assistantWatchout: safeString(product?.assistantWatchout || product?.watchout || ''),
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

    const capability = findAppAssistantCapability(raw);
    const normalizedRaw = normalizeCapabilityText(raw);
    const isGenericCatalogSearch = ['catalog', 'search'].includes(capability?.id)
        && SEARCH_PATTERN.test(raw)
        && /\b(search|find|need|want|best|recommend|under|below|within|budget)\b/.test(normalizedRaw);
    if (capability && !isGenericCatalogSearch) {
        return {
            type: 'capability',
            capability,
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

        const capability = findAppAssistantCapability(suggestion);
        const isStaticCapability = capability
            && capability.assistantAction === 'navigate_to'
            && !safeString(capability.route).includes(':')
            && (!Array.isArray(capability.contextRequired) || capability.contextRequired.length === 0);
        if (isStaticCapability && /^(?:open|show|view|go to|take me to)\b/i.test(suggestion)) {
            return [buildCapabilityAction(capability)];
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
    const totalItems = Math.max(0, Number(cartSummary?.totalItems ?? cartCount) || 0);
    const itemCount = Math.max(0, Number(cartSummary?.itemCount) || 0);
    const subtotal = Math.max(0, Number(cartSummary?.totalPrice) || 0);
    const savings = Math.max(0, Number(cartSummary?.totalDiscount) || 0);

    switch (command.type) {
        case 'help': {
            const routeCapability = findCapabilityForPath(options?.pathname || '/');
            const catalogCapability = APP_ASSISTANT_CAPABILITIES.find((entry) => entry.id === 'catalog');
            const cartCapability = APP_ASSISTANT_CAPABILITIES.find((entry) => entry.id === 'cart');
            const supportCapability = APP_ASSISTANT_CAPABILITIES.find((entry) => entry.id === 'support');
            const helpActions = [catalogCapability, cartCapability, supportCapability]
                .filter(Boolean)
                .map((capability) => buildCapabilityAction(capability));

            return {
                local: true,
                answer: [
                    routeCapability
                        ? `You are on ${routeCapability.title}. ${routeCapability.description}`
                        : 'I can explain and open the app\'s shopping, account, order, support, and seller surfaces.',
                    `Your current cart has ${totalItems} item${totalItems === 1 ? '' : 's'} with a subtotal of ${formatInr(subtotal)}.`,
                    'Without live model access I can still open catalog, deals, wishlist, cart, checkout, orders, profile, support, compare, price alerts, trade-in, and seller pages. I will not invent product, price, stock, payment, or order facts.',
                ].join(' '),
                mode: 'explore',
                primaryAction: helpActions[0] || null,
                secondaryActions: helpActions.slice(1, 3),
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
                answer: totalItems > 0
                    ? `Your cart has ${totalItems} item${totalItems === 1 ? '' : 's'}${itemCount > 0 ? ` across ${itemCount} product${itemCount === 1 ? '' : 's'}` : ''}. The current item subtotal is ${formatInr(subtotal)}${savings > 0 ? `, with ${formatInr(savings)} shown as item savings` : ''}. Checkout must verify the final price, stock, shipping, tax, and coupon eligibility.`
                    : 'Your cart is empty. Open the catalog to add a verified product; I have not invented any recommendations.',
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
                answer: totalItems > 0
                    ? `Your cart has ${totalItems} item${totalItems === 1 ? '' : 's'} with a current item subtotal of ${formatInr(subtotal)}. Open checkout to verify stock, address, shipping, tax, discounts, and payment before placing the order.`
                    : 'Checkout needs a non-empty cart. Open the catalog, add a verified product, then return to checkout.',
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
                answer: 'I can open the support desk with this issue prefilled. Without the live service I cannot verify order status, eligibility, refunds, cancellations, payments, or support outcomes.',
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
                answer: `Product reference ${safeString(command.productId)} is available in this conversation context. Open its product page to verify the current price, stock, rating, and specifications.`,
                mode: 'product',
                ...actions,
                activeProductId: safeString(command.productId),
            };
        }
        case 'capability': {
            const capability = command.capability || {};
            const params = capability.id === 'product' && activeProductId
                ? { productId: activeProductId }
                : capability.id === 'compare' && Array.isArray(options?.candidateProductIds)
                    ? { products: options.candidateProductIds.filter(Boolean).join(',') }
                    : {};
            const hasDynamicContext = !safeString(capability.route).includes(':')
                || (capability.id === 'product' && Boolean(activeProductId));
            const action = hasDynamicContext ? buildCapabilityAction(capability, params) : null;

            return {
                local: true,
                answer: `${safeString(capability.title)}: ${safeString(capability.description)}${buildCapabilityRequirementText(capability, options)} Live values and sensitive operations are verified by that page's APIs, not by this offline response.`,
                mode: capability.id === 'cart'
                    ? 'cart'
                    : capability.id === 'checkout'
                        ? 'checkout'
                        : capability.id === 'support'
                            ? 'support'
                            : 'explore',
                cartSummary: capability.id === 'cart' || capability.id === 'checkout' ? cartSummary : null,
                primaryAction: action,
                secondaryActions: [],
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

export const buildUnavailableAssistantResponse = (rawText = '', options = {}) => {
    const hasMedia = Boolean(options?.hasMedia);
    if (hasMedia) {
        return {
            answer: 'Image and audio analysis need the live assistant service. Your attachment was not analyzed, and I did not infer any product from it.',
            mode: 'explore',
            primaryAction: null,
            secondaryActions: [],
        };
    }

    const localResponse = buildLocalAssistantResponse(rawText, options);
    if (localResponse?.local === true) {
        return localResponse;
    }

    if (localResponse?.local === false) {
        const searchCapability = APP_ASSISTANT_CAPABILITIES.find((entry) => entry.id === 'search')
            || APP_ASSISTANT_CAPABILITIES.find((entry) => entry.id === 'catalog');
        return {
            answer: 'Live assistant search is unavailable, so I have not invented products or rankings. Open the catalog search to use canonical product data.',
            mode: 'explore',
            primaryAction: searchCapability ? buildCapabilityAction(searchCapability, {
                q: safeString(localResponse.query || rawText),
            }) : null,
            secondaryActions: [],
        };
    }

    const cartCapability = APP_ASSISTANT_CAPABILITIES.find((entry) => entry.id === 'cart');
    const catalogCapability = APP_ASSISTANT_CAPABILITIES.find((entry) => entry.id === 'catalog');
    return {
        answer: 'I could not reach live reasoning, so I cannot verify an answer to that question. Offline I can still report current cart totals and explain or open known app features; I will not invent catalog, price, stock, payment, or order facts.',
        mode: 'explore',
        primaryAction: catalogCapability ? buildCapabilityAction(catalogCapability) : null,
        secondaryActions: cartCapability ? [buildCapabilityAction(cartCapability)] : [],
    };
};

export const buildNonExecutableAssistantTurn = (assistantTurn = {}, response = '') => ({
    ...assistantTurn,
    decision: 'respond',
    actionRequest: null,
    actions: [],
    confirmation: null,
    navigation: null,
    response: safeString(response || assistantTurn?.response || ''),
    ui: {
        ...(assistantTurn?.ui || {}),
        surface: 'plain_answer',
        confirmation: null,
        navigation: null,
    },
    followUps: [],
});

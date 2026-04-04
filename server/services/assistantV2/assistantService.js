const { flags: assistantFlags } = require('../../config/assistantFlags');
const { getProductByIdentifier } = require('../catalogService');
const { processAssistantTurn } = require('../ai/assistantOrchestratorService');
const { assembleRouteContext } = require('./assistantRouteContextService');
const { composeAssistantResponse } = require('./assistantResponseComposer');
const { recordAssistantTurn } = require('./assistantTelemetryService');
const { safeString } = require('./assistantContract');

const DEFAULT_CART_SUMMARY = {
    totalPrice: 0,
    totalOriginalPrice: 0,
    totalDiscount: 0,
    totalItems: 0,
    itemCount: 0,
    currency: 'INR',
};

const PAGE_LABELS = {
    assistant: 'Open assistant',
    become_seller: 'Become a seller',
    bundles: 'Open bundles',
    cart: 'Open cart',
    category: 'Browse category',
    checkout: 'Open checkout',
    compare: 'Open compare',
    deals: 'Open deals',
    home: 'Go home',
    login: 'Open login',
    marketplace: 'Open marketplace',
    mission_control: 'Open mission control',
    my_listings: 'Open my listings',
    orders: 'Open orders',
    price_alerts: 'Open price alerts',
    product: 'Open product',
    profile: 'Open profile',
    sell: 'Open seller desk',
    support: 'Open support',
    trade_in: 'Open trade in',
    visual_search: 'Open visual search',
    wishlist: 'Open wishlist',
};

const buildExpiryIso = () => new Date(
    Date.now() + (Math.max(60, Number(assistantFlags.assistantV2SessionTtlSeconds || 1800)) * 1000)
).toISOString();

const normalizeCommerceContext = (commerceContext = {}, routeContext = {}) => {
    const routeProductId = safeString(routeContext?.entityType) === 'product'
        ? safeString(routeContext?.entityId || '')
        : '';

    return {
        activeProductId: safeString(commerceContext?.activeProductId || routeProductId || ''),
        candidateProductIds: [...new Set((Array.isArray(commerceContext?.candidateProductIds) ? commerceContext.candidateProductIds : [])
            .map((entry) => safeString(entry))
            .filter(Boolean))]
            .slice(0, 8),
        cartSummary: commerceContext?.cartSummary && typeof commerceContext.cartSummary === 'object'
            ? {
                totalPrice: Math.max(0, Number(commerceContext.cartSummary.totalPrice || 0)),
                totalOriginalPrice: Math.max(0, Number(commerceContext.cartSummary.totalOriginalPrice || 0)),
                totalDiscount: Math.max(0, Number(commerceContext.cartSummary.totalDiscount || 0)),
                totalItems: Math.max(0, Number(commerceContext.cartSummary.totalItems || 0)),
                itemCount: Math.max(0, Number(commerceContext.cartSummary.itemCount || 0)),
                currency: safeString(commerceContext.cartSummary.currency || 'INR'),
            }
            : { ...DEFAULT_CART_SUMMARY },
    };
};

const normalizeUserContext = ({ reqUser = null, payloadUserContext = {} } = {}) => ({
    authenticated: Boolean(reqUser?._id || payloadUserContext?.authenticated),
});

const normalizeProductSummary = (product = {}) => {
    const id = safeString(product?.id || product?._id || product?.externalId || '');
    if (!id) return null;

    return {
        id,
        title: safeString(product?.displayTitle || product?.title || product?.name || 'Untitled product'),
        brand: safeString(product?.brand || ''),
        category: safeString(product?.category || ''),
        price: Math.max(0, Number(product?.price || 0)),
        originalPrice: Math.max(0, Number(product?.originalPrice || product?.price || 0)),
        discountPercentage: Math.max(0, Number(product?.discountPercentage || 0)),
        image: safeString(product?.image || product?.thumbnail || ''),
        rating: Math.max(0, Math.min(5, Number(product?.rating || 0))),
        ratingCount: Math.max(0, Number(product?.ratingCount || 0)),
        deliveryTime: safeString(product?.deliveryTime || ''),
        stock: Math.max(0, Number(product?.stock || 0)),
    };
};

const dedupeProducts = (products = []) => {
    const seen = new Set();
    return (Array.isArray(products) ? products : [])
        .map((product) => normalizeProductSummary(product))
        .filter(Boolean)
        .filter((product) => {
            if (seen.has(product.id)) return false;
            seen.add(product.id);
            return true;
        })
        .slice(0, 8);
};

const loadProductContext = async (commerceContext = {}) => {
    const requestedIds = [
        safeString(commerceContext?.activeProductId || ''),
        ...(Array.isArray(commerceContext?.candidateProductIds) ? commerceContext.candidateProductIds : []),
    ]
        .map((entry) => safeString(entry))
        .filter(Boolean)
        .slice(0, 8);

    if (requestedIds.length === 0) {
        return {
            activeProduct: null,
            candidateProducts: [],
        };
    }

    const products = await Promise.all(
        requestedIds.map(async (productId) => {
            try {
                return normalizeProductSummary(await getProductByIdentifier(productId));
            } catch {
                return null;
            }
        })
    );

    const candidateProducts = dedupeProducts(products);
    const activeProductId = safeString(commerceContext?.activeProductId || '');
    return {
        activeProduct: candidateProducts.find((product) => product.id === activeProductId) || null,
        candidateProducts,
    };
};

const buildWorkspaceContext = ({
    routeContext = {},
    commerceContext = {},
    userContext = {},
    activeProduct = null,
    candidateProducts = [],
} = {}) => ({
    route: safeString(routeContext?.path || '/'),
    routeLabel: safeString(routeContext?.label || ''),
    category: safeString(routeContext?.entityType) === 'category'
        ? safeString(routeContext?.entityId || '')
        : '',
    cartSummary: commerceContext?.cartSummary || { ...DEFAULT_CART_SUMMARY },
    currentProductId: safeString(activeProduct?.id || commerceContext?.activeProductId || ''),
    currentProduct: activeProduct,
    latestProducts: candidateProducts,
    userAuthenticated: Boolean(userContext?.authenticated),
});

const createProductCard = (product = {}, index = 0) => ({
    type: 'product',
    id: `product:${safeString(product?.id || index)}`,
    title: index === 0 ? 'Best next option' : 'Also worth a look',
    description: safeString(product?.brand || product?.category || 'Grounded product option'),
    product,
});

const createEmptyStateCard = ({
    id = 'assistant-empty-state',
    title = 'Refine the brief',
    description = 'Tighten the request with a product clue, budget, page, or support task.',
} = {}) => ({
    type: 'empty_state',
    id: safeString(id || 'assistant-empty-state'),
    title: safeString(title || 'Refine the brief'),
    description: safeString(description || ''),
});

const buildComparisonCard = (products = []) => ({
    type: 'comparison',
    id: 'assistant-comparison',
    title: 'Side-by-side comparison',
    description: 'Grounded options from the unified assistant planner.',
    products: products.slice(0, 4),
});

const buildCards = ({ result = {} } = {}) => {
    const assistantTurn = result?.assistantTurn || {};
    const ui = assistantTurn?.ui && typeof assistantTurn.ui === 'object' ? assistantTurn.ui : {};
    const surface = safeString(ui?.surface || '');
    const uiProducts = dedupeProducts(ui?.products || result?.products || []);
    const focusProduct = normalizeProductSummary(ui?.product || null);
    const cartSummary = ui?.cartSummary && typeof ui.cartSummary === 'object'
        ? {
            totalPrice: Math.max(0, Number(ui.cartSummary.totalPrice || 0)),
            totalOriginalPrice: Math.max(0, Number(ui.cartSummary.totalOriginalPrice || 0)),
            totalDiscount: Math.max(0, Number(ui.cartSummary.totalDiscount || 0)),
            totalItems: Math.max(0, Number(ui.cartSummary.totalItems || 0)),
            itemCount: Math.max(0, Number(ui.cartSummary.itemCount || 0)),
            currency: safeString(ui.cartSummary.currency || 'INR'),
        }
        : null;
    const hasCompareNavigation = (Array.isArray(result?.actions) ? result.actions : [])
        .some((action) => safeString(action?.type || '') === 'navigate_to' && safeString(action?.page || '') === 'compare');

    if (surface === 'cart_summary' && cartSummary) {
        return [{
            type: 'cart_summary',
            id: 'cart-summary',
            title: 'Current cart',
            description: 'Live snapshot from the unified assistant session.',
            cartSummary,
        }];
    }

    if ((surface === 'product_focus' || focusProduct) && focusProduct?.id) {
        return [createProductCard(focusProduct, 0)];
    }

    if ((surface === 'product_results' || uiProducts.length > 0) && uiProducts.length >= 2 && hasCompareNavigation) {
        return [buildComparisonCard(uiProducts)];
    }

    if (surface === 'product_results' || uiProducts.length > 0) {
        return uiProducts.slice(0, 3).map((product, index) => createProductCard(product, index));
    }

    if (surface === 'support_handoff') {
        return [createEmptyStateCard({
            id: 'support-handoff',
            title: 'Support handoff ready',
            description: safeString(result?.answer || assistantTurn?.response || 'Open the support desk to continue with durable ticketing and escalation.'),
        })];
    }

    if (surface === 'confirmation_card') {
        return [createEmptyStateCard({
            id: 'confirmation-needed',
            title: 'Confirmation needed',
            description: safeString(ui?.confirmation?.message || result?.answer || assistantTurn?.response || 'Reply yes to continue.'),
        })];
    }

    if (safeString(assistantTurn?.intent || '') === 'product_search') {
        return [createEmptyStateCard({
            id: 'refine-brief',
            description: safeString(result?.answer || assistantTurn?.response || 'I need a tighter product clue, budget, or comparison target.'),
        })];
    }

    return [];
};

const buildActionLabel = (action = {}) => {
    const type = safeString(action?.type || '');
    if (safeString(action?.label || '')) {
        return safeString(action.label);
    }

    if (type === 'add_to_cart') return 'Add to cart';
    if (type === 'remove_from_cart') return 'Remove from cart';
    if (type === 'search_products') return 'Refresh results';
    if (type === 'select_product') return 'Open product';
    if (type === 'go_to_checkout') return 'Open checkout';
    if (type === 'track_order') return 'Track order';
    if (type === 'open_support') return 'Open support';
    if (type === 'navigate_to') {
        return PAGE_LABELS[safeString(action?.page || '')] || 'Open page';
    }
    if (type === 'open_product') return 'Open product';
    if (type === 'open_category') return 'Browse category';
    if (type === 'open_cart') return 'Open cart';
    if (type === 'open_checkout') return 'Open checkout';
    return '';
};

const buildActions = ({ result = {} } = {}) => (
    (Array.isArray(result?.actions) ? result.actions : [])
        .map((action) => {
            const type = safeString(action?.type || '');
            if (!type) return null;

            return {
                ...action,
                label: buildActionLabel(action),
                productId: safeString(action?.productId || ''),
                category: safeString(action?.category || ''),
                page: safeString(action?.page || ''),
                params: action?.params && typeof action.params === 'object' ? action.params : {},
                orderId: safeString(action?.orderId || ''),
                prefill: action?.prefill && typeof action.prefill === 'object' ? action.prefill : null,
            };
        })
        .filter(Boolean)
        .slice(0, 5)
);

const buildSupportDraft = ({ result = {} } = {}) => {
    const assistantTurn = result?.assistantTurn || {};
    const uiSupport = assistantTurn?.ui?.support?.prefill && typeof assistantTurn.ui.support.prefill === 'object'
        ? assistantTurn.ui.support.prefill
        : null;
    const supportAction = (Array.isArray(result?.actions) ? result.actions : [])
        .find((action) => safeString(action?.type || '') === 'open_support');
    const source = uiSupport || supportAction?.prefill || null;
    if (!source || typeof source !== 'object') {
        return null;
    }

    return {
        category: safeString(source?.category || 'general'),
        subject: safeString(source?.subject || ''),
        body: safeString(source?.body || source?.intent || ''),
        relatedOrderId: safeString(
            result?.assistantTurn?.ui?.support?.orderId
            || supportAction?.orderId
            || source?.relatedOrderId
            || ''
        ),
    };
};

const buildTelemetry = ({ result = {} } = {}) => {
    const assistantTurn = result?.assistantTurn || {};
    const uiProducts = Array.isArray(assistantTurn?.ui?.products) ? assistantTurn.ui.products : [];
    const hits = Math.max(
        0,
        Number(result?.products?.length || 0),
        Number(uiProducts.length || 0)
    );
    const provider = safeString(result?.provider || 'local');
    const answerMode = safeString(assistantTurn?.answerMode || 'commerce');

    return {
        latencyMs: Math.max(0, Number(result?.latencyMs || 0)),
        source: provider === 'local'
            ? `orchestrator:${answerMode}`
            : `planner:${provider}`,
        retrievalHits: hits,
    };
};

const createAssistantTurn = async ({
    sessionId = '',
    message = '',
    routeContext = {},
    commerceContext = {},
    userContext = {},
    reqUser = null,
}) => {
    const normalizedRouteContext = assembleRouteContext(routeContext);
    const normalizedCommerceContext = normalizeCommerceContext(commerceContext, normalizedRouteContext);
    const normalizedUserContext = normalizeUserContext({
        reqUser,
        payloadUserContext: userContext,
    });
    const { activeProduct, candidateProducts } = await loadProductContext(normalizedCommerceContext);
    const context = buildWorkspaceContext({
        routeContext: normalizedRouteContext,
        commerceContext: normalizedCommerceContext,
        userContext: normalizedUserContext,
        activeProduct,
        candidateProducts,
    });

    const result = await processAssistantTurn({
        user: reqUser || null,
        message,
        assistantMode: 'assistant_workspace',
        sessionId,
        context,
    });

    const session = {
        id: safeString(result?.assistantSession?.sessionId || sessionId || ''),
        expiresAt: buildExpiryIso(),
    };
    const response = composeAssistantResponse({
        session,
        reply: {
            text: safeString(result?.answer || result?.assistantTurn?.response || ''),
            intent: safeString(result?.assistantTurn?.intent || 'general_help'),
            confidence: Math.max(0, Number(result?.assistantTurn?.confidence || 0)),
        },
        cards: buildCards({ result }),
        actions: buildActions({ result }),
        supportDraft: buildSupportDraft({ result }),
        telemetry: buildTelemetry({ result }),
    });

    recordAssistantTurn({
        session,
        intent: response.reply.intent,
        routeContext: normalizedRouteContext,
        telemetry: response.telemetry,
        actions: response.actions,
        supportDraft: response.supportDraft,
    });

    return response;
};

module.exports = {
    createAssistantTurn,
};

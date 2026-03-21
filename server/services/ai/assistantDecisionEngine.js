const { getProductByIdentifier } = require('../catalogService');
const {
    buildGroundedCatalogContext,
    detectCategoryHint,
    extractBudget,
    looksCommerceIntent,
} = require('../assistantCommerceService');
const { generateStructuredResponse } = require('./providerRegistry');
const {
    buildAssistantTurn,
    buildConfirmationToken,
    normalizeEntities,
    normalizeIntent,
    safeString,
} = require('./assistantContract');

const safeLower = (value, fallback = '') => safeString(value, fallback).toLowerCase();
const clamp = (value, min, max) => Math.min(Math.max(Number(value) || 0, min), max);

const PAGE_ALIASES = [
    { page: 'home', path: '/', aliases: ['home', 'homepage'] },
    { page: 'cart', path: '/cart', aliases: ['cart', 'bag', 'basket'] },
    { page: 'checkout', path: '/checkout', aliases: ['checkout', 'payment', 'pay now'] },
    { page: 'orders', path: '/orders', aliases: ['orders', 'my orders', 'order history'] },
    { page: 'profile', path: '/profile', aliases: ['profile', 'account'] },
    { page: 'support', path: '/profile?tab=support', aliases: ['support', 'help desk', 'customer care', 'help center'] },
    { page: 'wishlist', path: '/wishlist', aliases: ['wishlist', 'favorites', 'favourites'] },
    { page: 'marketplace', path: '/marketplace', aliases: ['marketplace', 'market place', 'market'] },
    { page: 'deals', path: '/deals', aliases: ['deals', 'offers', 'discounts'] },
    { page: 'trending', path: '/trending', aliases: ['trending', 'popular now'] },
    { page: 'new_arrivals', path: '/new-arrivals', aliases: ['new arrivals', 'latest arrivals'] },
    { page: 'compare', path: '/compare', aliases: ['compare', 'comparison'] },
    { page: 'bundles', path: '/bundles', aliases: ['bundle', 'bundles', 'smart bundle'] },
    { page: 'visual_search', path: '/visual-search', aliases: ['visual search', 'camera search', 'image search'] },
];

const SUPPORT_CATEGORY_RULES = [
    { category: 'refund', pattern: /\b(refund|refunds|money back)\b/i },
    { category: 'return', pattern: /\b(return|returns)\b/i },
    { category: 'replacement', pattern: /\b(replace|replacement|exchange)\b/i },
    { category: 'delivery', pattern: /\b(delivery|late|shipping|shipment|courier)\b/i },
    { category: 'payment', pattern: /\b(payment|charged|upi|card|wallet)\b/i },
    { category: 'warranty', pattern: /\b(warranty|repair|service center|service centre)\b/i },
    { category: 'account', pattern: /\b(account|login|password|profile)\b/i },
];

const stripNoise = (value = '') => safeString(value)
    .replace(/[^\w\s&'-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const extractPriceRange = (text = '') => {
    const normalized = safeString(text);
    const betweenMatch = normalized.match(/between\s*(?:rs\.?|inr|₹)?\s*(\d[\d,]*)\s*(?:and|to)\s*(?:rs\.?|inr|₹)?\s*(\d[\d,]*)/i);
    if (betweenMatch) {
        return {
            priceMin: Number(String(betweenMatch[1]).replace(/,/g, '')) || 0,
            priceMax: Number(String(betweenMatch[2]).replace(/,/g, '')) || 0,
        };
    }

    const aboveMatch = normalized.match(/(?:above|over|min(?:imum)?)\s*(?:rs\.?|inr|₹)?\s*(\d[\d,]*)/i);
    if (aboveMatch) {
        return {
            priceMin: Number(String(aboveMatch[1]).replace(/,/g, '')) || 0,
            priceMax: 0,
        };
    }

    return {
        priceMin: 0,
        priceMax: extractBudget(normalized),
    };
};

const cleanSearchQuery = (message = '', category = '') => {
    const scrubbed = stripNoise(message)
        .replace(/\b(add|remove|delete|take|go|navigate|open|show|find|search|look|for|me|my|please|to|the|a|an|best|cheap|affordable|budget|under|below|within|between|compare|vs|versus|track|order|support|help|checkout|cart|buy|purchase)\b/ig, ' ')
        .replace(/\b(rs|inr)\s*\d[\d,]*/ig, ' ')
        .replace(/\b\d[\d,]*\b/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

    if (!scrubbed) return '';
    if (category && safeLower(scrubbed) === safeLower(category)) return '';
    return scrubbed;
};

const inferNavigationTarget = (message = '') => {
    const normalized = safeLower(message);
    const match = PAGE_ALIASES.find((entry) => entry.aliases.some((alias) => normalized.includes(alias)));
    return match || null;
};

const inferSupportCategory = (message = '') => {
    const match = SUPPORT_CATEGORY_RULES.find((entry) => entry.pattern.test(message));
    return match ? match.category : '';
};

const extractOrderId = (message = '', context = {}) => {
    const fromText = safeString(
        message.match(/\b(?:order(?:\s+id)?|tracking(?:\s+id)?)\s*(?:#|no\.?|number)?\s*([a-z0-9-]{3,})\b/i)?.[1]
        || message.match(/\b#([a-z0-9-]{3,})\b/i)?.[1]
        || ''
    );
    if (fromText) return fromText;
    return safeString(
        context?.orderId
        || context?.activeOrderId
        || context?.currentOrderId
        || context?.supportContext?.orderId
        || ''
    );
};

const extractQuantity = (message = '', fallback = 1) => {
    const fromText = Number(message.match(/\b(?:qty|quantity|add|remove)\s*(\d+)\b/i)?.[1] || 0);
    if (fromText > 0) return fromText;
    const leadingCount = Number(message.match(/\b(\d+)\s+(?:items?|pieces?|units?)\b/i)?.[1] || 0);
    if (leadingCount > 0) return leadingCount;
    return fallback;
};

const inferCartOperation = (message = '') => {
    if (/\b(add|buy|place in cart|put in cart)\b/i.test(message)) return 'add';
    if (/\b(remove|delete|take out|drop from cart)\b/i.test(message)) return 'remove';
    if (/\b(show|view|open)\b.*\b(cart|bag)\b/i.test(message)) return 'view';
    return '';
};

const inferProductAction = (message = '') => {
    if (/\b(select|choose|pick|open|view details|show details|this one|that one)\b/i.test(message)) return 'select';
    return '';
};

const inferCompareTerms = (message = '') => {
    const match = message.match(/(.+?)\s+(?:vs|versus)\s+(.+)/i);
    if (!match) return [];

    return [stripNoise(match[1]), stripNoise(match[2])]
        .map((entry) => entry.replace(/(?:under|below|within|for|budget).*/i, '').trim())
        .filter(Boolean)
        .slice(0, 2);
};

const resolveContextProductId = (context = {}) => safeString(
    context?.productId
    || context?.currentProductId
    || context?.selectedProductId
    || context?.activeProductId
    || context?.product?._id
    || context?.product?.id
    || context?.currentProduct?._id
    || context?.currentProduct?.id
    || context?.focusProduct?._id
    || context?.focusProduct?.id
    || ''
);

const resolveContextProduct = (context = {}) => {
    const direct = context?.product || context?.currentProduct || context?.focusProduct || null;
    if (direct && typeof direct === 'object') return direct;

    const candidates = Array.isArray(context?.products)
        ? context.products
        : Array.isArray(context?.visibleProducts)
            ? context.visibleProducts
            : [];

    const productId = resolveContextProductId(context);
    if (!productId) return null;
    return candidates.find((entry) => safeString(entry?._id || entry?.id) === productId) || null;
};

const buildCartSummary = (context = {}) => {
    const directSummary = context?.cartSummary && typeof context.cartSummary === 'object'
        ? context.cartSummary
        : null;
    if (directSummary) return directSummary;

    const cartItems = Array.isArray(context?.cartItems)
        ? context.cartItems
        : Array.isArray(context?.cart?.items)
            ? context.cart.items
            : [];

    const totalItems = cartItems.reduce((sum, item) => sum + Math.max(0, Number(item?.qty || item?.quantity || 0)), 0);
    const subtotal = cartItems.reduce((sum, item) => sum + ((Number(item?.price || item?.product?.price || 0) || 0) * Math.max(0, Number(item?.qty || item?.quantity || 0))), 0);

    return {
        itemCount: totalItems,
        subtotal,
    };
};

const scoreComparisonCandidate = (product = {}) => {
    const rating = Number(product.rating || 0);
    const reviews = Number(product.ratingCount || 0);
    const discount = Number(product.discountPercentage || 0);
    const price = Number(product.price || 0);
    return (rating * 32) + Math.min(reviews / 120, 28) + (discount * 0.9) + (price > 0 ? Math.min(120000 / price, 18) : 0);
};

const buildDeterministicClassification = ({
    message = '',
    assistantMode = 'chat',
    context = {},
}) => {
    const priceRange = extractPriceRange(message);
    const category = detectCategoryHint(message);
    const pageTarget = inferNavigationTarget(message);
    const orderId = extractOrderId(message, context);
    const supportCategory = inferSupportCategory(message);
    const productId = safeString(
        message.match(/\b(?:product|item)\s+([a-z0-9._-]{4,})\b/i)?.[1]
        || resolveContextProductId(context)
    );
    const compareTerms = inferCompareTerms(message);
    const operation = inferCartOperation(message) || inferProductAction(message);
    const explicitSearch = /\b(find|search|show me|looking for|recommend|suggest|best|under|below|cheap|affordable|deal|deals|compare|vs|versus)\b/i.test(message);
    const explicitSupport = /\b(help|support|issue|problem|refund|return|replace|replacement|warranty|complaint)\b/i.test(message);
    const explicitCheckout = /\b(checkout|place order|pay now|proceed to payment)\b/i.test(message);
    const explicitTracking = /\b(track|where is my order|order status|delivery status)\b/i.test(message);
    const explicitNavigation = /\b(go to|take me to|open|show|navigate)\b/i.test(message) && Boolean(pageTarget);
    const explicitCartAction = /\b(add|remove|delete)\b/i.test(message) && /\b(cart|bag)\b/i.test(message) || /^(add|remove)\b/i.test(safeLower(message));
    const explicitSelection = /\b(select|choose|pick|this one|that one|open product|view details)\b/i.test(message);
    const commerceIntent = looksCommerceIntent(message, []);

    let intent = 'general_knowledge';
    let confidence = 0.42;

    if (assistantMode === 'compare' && Array.isArray(context?.productIds) && context.productIds.length >= 2) {
        intent = 'product_selection';
        confidence = 0.95;
    } else if (assistantMode === 'bundle' && Array.isArray(context?.bundle?.items) && context.bundle.items.length > 0) {
        intent = 'product_search';
        confidence = 0.9;
    } else if (explicitCheckout || pageTarget?.page === 'checkout') {
        intent = 'checkout';
        confidence = 0.96;
    } else if (explicitTracking || (explicitSupport && orderId)) {
        intent = 'support';
        confidence = orderId ? 0.95 : 0.8;
    } else if (explicitSupport) {
        intent = 'support';
        confidence = 0.88;
    } else if (explicitNavigation) {
        intent = 'navigation';
        confidence = 0.92;
    } else if (explicitCartAction) {
        intent = 'cart_action';
        confidence = productId ? 0.94 : 0.82;
    } else if (explicitSelection || (assistantMode === 'voice' && productId)) {
        intent = 'product_selection';
        confidence = productId ? 0.9 : 0.68;
    } else if (explicitSearch || commerceIntent || compareTerms.length > 0 || category || priceRange.priceMax > 0 || priceRange.priceMin > 0) {
        intent = 'product_search';
        confidence = compareTerms.length > 0 ? 0.92 : 0.84;
    } else if (assistantMode === 'voice' && pageTarget) {
        intent = 'navigation';
        confidence = 0.75;
    }

    return {
        intent,
        confidence,
        entities: normalizeEntities({
            query: cleanSearchQuery(message, category),
            productId,
            productIds: Array.isArray(context?.productIds) ? context.productIds : [],
            quantity: extractQuantity(message, intent === 'cart_action' ? 1 : 0),
            priceMin: priceRange.priceMin,
            priceMax: priceRange.priceMax,
            category,
            page: pageTarget?.page || '',
            orderId,
            supportCategory,
            operation,
            compareTerms,
        }),
        needsClarification: false,
        source: 'deterministic',
    };
};

const buildClassificationSystemPrompt = () => [
    'You classify ecommerce assistant turns.',
    'Return strict JSON only.',
    'Allowed intents: general_knowledge, product_search, product_selection, cart_action, checkout, navigation, support.',
    'Schema:',
    '{"intent":"string","confidence":0.0,"entities":{"query":"string","productId":"string","productIds":["string"],"quantity":0,"priceMin":0,"priceMax":0,"category":"string","page":"string","orderId":"string","supportCategory":"string","operation":"string","compareTerms":["string"]},"needsClarification":false,"clarificationReason":"string"}',
    'Rules:',
    '- general_knowledge is for broad world knowledge or explanatory questions with no app action.',
    '- product_search is for shopping discovery, comparison, recommendations, budgets, or filtering.',
    '- product_selection is for choosing or opening a specific product.',
    '- cart_action is only for add/remove cart requests, not for viewing the cart page.',
    '- checkout is only for checkout, payment, or place-order requests.',
    '- navigation is for opening app pages such as cart, orders, profile, categories, wishlist, or marketplace.',
    '- support is for order help, refunds, returns, replacements, warranty, complaints, or tracking.',
    '- Populate only grounded entities inferred from the message and context.',
    '- If the request is ambiguous, set needsClarification true and lower confidence.',
].join('\n');

const buildClassificationUserPrompt = ({
    message,
    assistantMode,
    context,
    deterministic,
}) => [
    `User message: ${safeString(message)}`,
    `Assistant mode: ${safeString(assistantMode || 'chat')}`,
    `Context summary: ${JSON.stringify({
        route: context?.route || context?.pathname || context?.page || '',
        currentProductId: resolveContextProductId(context),
        orderId: extractOrderId('', context),
        cartItemCount: Array.isArray(context?.cartItems) ? context.cartItems.length : Number(context?.cartSummary?.itemCount || 0),
    })}`,
    `Deterministic hint: ${JSON.stringify({
        intent: deterministic.intent,
        confidence: deterministic.confidence,
        entities: deterministic.entities,
    })}`,
    'Return JSON only.',
].join('\n\n');

const mergeEntities = (primary = {}, fallback = {}) => {
    const normalizedPrimary = normalizeEntities(primary);
    const normalizedFallback = normalizeEntities(fallback);

    return normalizeEntities({
        query: normalizedPrimary.query || normalizedFallback.query,
        productId: normalizedPrimary.productId || normalizedFallback.productId,
        productIds: normalizedPrimary.productIds.length > 0 ? normalizedPrimary.productIds : normalizedFallback.productIds,
        quantity: normalizedPrimary.quantity || normalizedFallback.quantity,
        priceMin: normalizedPrimary.priceMin || normalizedFallback.priceMin,
        priceMax: normalizedPrimary.priceMax || normalizedFallback.priceMax,
        category: normalizedPrimary.category || normalizedFallback.category,
        page: normalizedPrimary.page || normalizedFallback.page,
        orderId: normalizedPrimary.orderId || normalizedFallback.orderId,
        supportCategory: normalizedPrimary.supportCategory || normalizedFallback.supportCategory,
        operation: normalizedPrimary.operation || normalizedFallback.operation,
        compareTerms: normalizedPrimary.compareTerms.length > 0 ? normalizedPrimary.compareTerms : normalizedFallback.compareTerms,
    });
};

const classifyAssistantTurn = async ({
    message = '',
    assistantMode = 'chat',
    context = {},
}) => {
    const deterministic = buildDeterministicClassification({
        message,
        assistantMode,
        context,
    });

    const response = await generateStructuredResponse({
        systemPrompt: buildClassificationSystemPrompt(),
        userPrompt: buildClassificationUserPrompt({
            message,
            assistantMode,
            context,
            deterministic,
        }),
        temperature: 0.05,
        maxTokens: 350,
        preferVision: false,
    });

    if (!response?.payload || response.provider === 'local') {
        return deterministic;
    }

    const payload = response.payload || {};
    const intent = normalizeIntent(payload.intent, deterministic.intent);
    const entities = mergeEntities(payload.entities || {}, deterministic.entities);
    const confidence = clamp(
        Number(payload.confidence || 0) || deterministic.confidence,
        0,
        1
    );
    const needsClarification = Boolean(payload.needsClarification)
        || (confidence < 0.45 && deterministic.confidence < 0.55);

    if (confidence < 0.55 && deterministic.confidence >= 0.85) {
        return {
            ...deterministic,
            source: 'deterministic_override',
            provider: response.provider,
        };
    }

    return {
        intent,
        confidence,
        entities,
        needsClarification,
        clarificationReason: safeString(payload.clarificationReason || ''),
        source: response.provider,
        provider: response.provider,
    };
};

const enrichAssistantContext = async ({
    user = null,
    message = '',
    conversationHistory = [],
    assistantMode = 'chat',
    context = {},
    classification = {},
}) => {
    const entities = normalizeEntities(classification.entities || {});
    const cartSummary = buildCartSummary(context);
    const contextProduct = resolveContextProduct(context);
    let selectedProduct = contextProduct || null;
    let groundedCatalog = null;
    let compareProducts = [];
    let bundleProducts = [];

    if (assistantMode === 'compare' && Array.isArray(context?.productIds) && context.productIds.length > 0) {
        compareProducts = (await Promise.all(
            context.productIds.slice(0, 4).map((productId) => getProductByIdentifier(productId).catch(() => null))
        )).filter(Boolean);
    }

    if (assistantMode === 'bundle' && Array.isArray(context?.bundle?.items)) {
        bundleProducts = context.bundle.items.filter(Boolean);
    }

    if (classification.intent === 'product_search' || classification.intent === 'product_selection') {
        groundedCatalog = await buildGroundedCatalogContext({
            message,
            conversationHistory,
        }).catch(() => null);
    }

    if (!selectedProduct && entities.productId) {
        selectedProduct = await getProductByIdentifier(entities.productId).catch(() => null);
    }

    if (!selectedProduct && compareProducts.length > 0) {
        selectedProduct = [...compareProducts].sort((left, right) => scoreComparisonCandidate(right) - scoreComparisonCandidate(left))[0] || null;
    }

    if (!selectedProduct && classification.intent === 'product_selection') {
        selectedProduct = groundedCatalog?.products?.[0] || null;
    }

    const routeTarget = entities.page
        ? PAGE_ALIASES.find((entry) => entry.page === entities.page) || null
        : inferNavigationTarget(message);

    const supportPrefill = {
        subject: safeString(context?.supportPrefill?.subject || ''),
        category: entities.supportCategory || safeString(context?.supportPrefill?.category || ''),
        body: safeString(context?.supportPrefill?.body || message),
        intent: classification.intent,
    };

    return {
        userId: safeString(user?._id || ''),
        assistantMode: safeString(assistantMode || 'chat'),
        groundedCatalog,
        selectedProduct,
        visibleProducts: compareProducts.length > 0
            ? compareProducts
            : bundleProducts.length > 0
                ? bundleProducts
                : Array.isArray(groundedCatalog?.products)
                    ? groundedCatalog.products
                    : [],
        cartSummary,
        routeTarget,
        supportPrefill,
        orderId: entities.orderId,
        existingContext: context,
    };
};

const buildSearchFilters = (entities = {}) => {
    const normalized = normalizeEntities(entities);
    return {
        category: normalized.category,
        priceMin: normalized.priceMin,
        priceMax: normalized.priceMax,
    };
};

const planAssistantTurn = ({
    message = '',
    classification = {},
    enriched = {},
}) => {
    const intent = normalizeIntent(classification.intent);
    const entities = normalizeEntities(classification.entities || {});
    const confidence = clamp(classification.confidence || 0, 0, 1);
    const visibleProducts = Array.isArray(enriched.visibleProducts) ? enriched.visibleProducts : [];
    const selectedProduct = enriched.selectedProduct || null;
    const cartSummary = enriched.cartSummary || null;
    const routeTarget = enriched.routeTarget || null;
    const supportPrefill = enriched.supportPrefill || null;

    const makeClarify = (question, ui = {}) => buildAssistantTurn({
        intent,
        entities,
        confidence,
        decision: 'clarify',
        response: safeString(question),
        actions: [],
        ui: {
            surface: ui.surface || 'plain_answer',
            ...ui,
        },
        contextPatch: {
            currentIntent: intent,
            lastAssistantTurnAt: new Date().toISOString(),
        },
    });

    if (classification.needsClarification) {
        return makeClarify(
            classification.clarificationReason || 'Can you clarify what you want me to do?',
        );
    }

    if (intent === 'general_knowledge') {
        return buildAssistantTurn({
            intent,
            entities,
            confidence,
            decision: 'respond',
            response: '',
            actions: [],
            ui: {
                surface: 'plain_answer',
            },
            contextPatch: {
                currentIntent: intent,
                lastQuestion: safeString(message),
            },
        });
    }

    if (safeString(enriched.assistantMode) === 'compare' && visibleProducts.length >= 2 && selectedProduct) {
        return buildAssistantTurn({
            intent: 'product_selection',
            entities: {
                ...entities,
                productId: safeString(selectedProduct?._id || selectedProduct?.id),
                productIds: visibleProducts.map((product) => safeString(product?._id || product?.id)).filter(Boolean),
            },
            confidence,
            decision: 'act',
            response: '',
            actions: [{
                type: 'select_product',
                productId: safeString(selectedProduct?._id || selectedProduct?.id),
                reason: 'compare_mode_winner',
            }],
            ui: {
                surface: 'product_focus',
                product: selectedProduct,
                products: visibleProducts,
            },
            contextPatch: {
                currentIntent: 'product_selection',
                selectedProductId: safeString(selectedProduct?._id || selectedProduct?.id),
                visibleProductIds: visibleProducts.map((product) => safeString(product?._id || product?.id)).filter(Boolean),
            },
        });
    }

    if (intent === 'product_search') {
        if (!entities.query && !entities.category && entities.compareTerms.length === 0 && !visibleProducts.length) {
            return makeClarify('What kind of product should I look for?', {
                surface: 'plain_answer',
            });
        }

        return buildAssistantTurn({
            intent,
            entities,
            confidence,
            decision: 'act',
            response: '',
            actions: [{
                type: 'search_products',
                query: entities.query || safeString(message),
                filters: buildSearchFilters(entities),
                reason: entities.compareTerms.length > 0 ? 'compare_products' : 'product_discovery',
            }],
            ui: {
                surface: 'product_results',
                products: visibleProducts,
                title: entities.query
                    ? `Results for ${entities.query}`
                    : entities.category
                        ? `${entities.category} results`
                        : 'Product results',
            },
            contextPatch: {
                currentIntent: intent,
                lastQuery: entities.query || safeString(message),
                visibleProductIds: visibleProducts.map((product) => safeString(product?._id || product?.id)).filter(Boolean),
            },
        });
    }

    if (intent === 'product_selection') {
        if (!selectedProduct) {
            return makeClarify('Which product should I open?', {
                surface: 'plain_answer',
            });
        }

        return buildAssistantTurn({
            intent,
            entities: {
                ...entities,
                productId: entities.productId || safeString(selectedProduct?._id || selectedProduct?.id),
            },
            confidence,
            decision: 'act',
            response: '',
            actions: [{
                type: 'select_product',
                productId: safeString(selectedProduct?._id || selectedProduct?.id),
                reason: 'user_selected_product',
            }],
            ui: {
                surface: 'product_focus',
                product: selectedProduct,
            },
            contextPatch: {
                currentIntent: intent,
                selectedProductId: safeString(selectedProduct?._id || selectedProduct?.id),
            },
        });
    }

    if (intent === 'cart_action') {
        const productId = entities.productId || safeString(selectedProduct?._id || selectedProduct?.id);
        const operation = safeString(entities.operation || '');
        if (!operation || operation === 'view') {
            return buildAssistantTurn({
                intent: 'navigation',
                entities: {
                    ...entities,
                    page: 'cart',
                },
                confidence,
                decision: 'act',
                response: '',
                actions: [{
                    type: 'navigate_to',
                    page: 'cart',
                    reason: 'view_cart',
                }],
                ui: {
                    surface: 'cart_summary',
                    cartSummary,
                    navigation: {
                        page: 'cart',
                        path: '/cart',
                        params: {},
                    },
                },
                contextPatch: {
                    currentIntent: 'navigation',
                    lastPage: 'cart',
                },
            });
        }

        if (!productId) {
            return makeClarify(operation === 'remove'
                ? 'Which cart item should I remove?'
                : 'Which product should I add to your cart?');
        }

        const actionType = operation === 'remove' ? 'remove_from_cart' : 'add_to_cart';
        return buildAssistantTurn({
            intent,
            entities: {
                ...entities,
                productId,
                quantity: Math.max(1, entities.quantity || 1),
            },
            confidence,
            decision: 'act',
            response: '',
            actions: [{
                type: actionType,
                productId,
                quantity: Math.max(1, entities.quantity || 1),
                reason: operation === 'remove' ? 'user_removed_item' : 'user_added_item',
            }],
            ui: {
                surface: 'cart_summary',
                cartSummary,
                product: selectedProduct,
            },
            contextPatch: {
                currentIntent: intent,
                selectedProductId: productId,
            },
        });
    }

    if (intent === 'checkout') {
        const pendingAction = {
            type: 'go_to_checkout',
            requiresConfirmation: true,
            reason: 'critical_checkout_transition',
        };
        const token = buildConfirmationToken(pendingAction);
        return buildAssistantTurn({
            intent,
            entities,
            confidence,
            decision: 'clarify',
            response: '',
            actions: [],
            ui: {
                surface: 'confirmation_card',
                confirmation: {
                    token,
                    message: 'Checkout affects payment and order placement. Confirm before continuing.',
                    action: pendingAction,
                },
            },
            contextPatch: {
                currentIntent: intent,
                pendingConfirmation: {
                    token,
                    action: pendingAction,
                    message: 'Checkout affects payment and order placement. Confirm before continuing.',
                },
            },
        });
    }

    if (intent === 'navigation') {
        const page = entities.page || routeTarget?.page || '';
        const path = routeTarget?.path || '/';
        if (!page) {
            return makeClarify('Which page should I open?');
        }

        return buildAssistantTurn({
            intent,
            entities: {
                ...entities,
                page,
            },
            confidence,
            decision: 'act',
            response: '',
            actions: [{
                type: 'navigate_to',
                page,
                params: {},
                reason: 'user_navigation_request',
            }],
            ui: {
                surface: page === 'cart' ? 'cart_summary' : 'navigation_notice',
                cartSummary: page === 'cart' ? cartSummary : null,
                navigation: {
                    page,
                    path,
                    params: {},
                },
            },
            contextPatch: {
                currentIntent: intent,
                lastPage: page,
            },
        });
    }

    if (intent === 'support') {
        if (/\b(track|status|where is)\b/i.test(message) || entities.orderId) {
            if (entities.orderId) {
                return buildAssistantTurn({
                    intent,
                    entities,
                    confidence,
                    decision: 'act',
                    response: '',
                    actions: [{
                        type: 'track_order',
                        orderId: entities.orderId,
                        reason: 'order_tracking_request',
                    }],
                    ui: {
                        surface: 'support_handoff',
                        support: {
                            orderId: entities.orderId,
                            prefill: supportPrefill,
                        },
                    },
                    contextPatch: {
                        currentIntent: intent,
                        lastOrderId: entities.orderId,
                    },
                });
            }

            return buildAssistantTurn({
                intent: 'navigation',
                entities: {
                    ...entities,
                    page: 'orders',
                },
                confidence,
                decision: 'act',
                response: '',
                actions: [{
                    type: 'navigate_to',
                    page: 'orders',
                    reason: 'track_order_without_id',
                }],
                ui: {
                    surface: 'navigation_notice',
                    navigation: {
                        page: 'orders',
                        path: '/orders',
                        params: {},
                    },
                },
                contextPatch: {
                    currentIntent: 'navigation',
                    lastPage: 'orders',
                },
            });
        }

        return buildAssistantTurn({
            intent,
            entities,
            confidence,
            decision: 'act',
            response: '',
            actions: [{
                type: 'open_support',
                orderId: entities.orderId,
                prefill: supportPrefill,
                reason: entities.orderId ? 'order_specific_support' : 'profile_support_handoff',
            }],
            ui: {
                surface: 'support_handoff',
                support: {
                    orderId: entities.orderId,
                    prefill: supportPrefill,
                },
            },
            contextPatch: {
                currentIntent: intent,
                lastOrderId: entities.orderId,
                supportPrefill,
            },
        });
    }

    return makeClarify('Can you tell me a little more about what you want to do?');
};

const buildDefaultResponse = ({ turn = {}, enriched = {} }) => {
    const products = Array.isArray(turn?.ui?.products) ? turn.ui.products : [];
    const product = turn?.ui?.product || enriched.selectedProduct || null;
    const page = turn?.ui?.navigation?.page || '';
    const action = Array.isArray(turn?.actions) ? turn.actions[0] : null;

    if (turn.intent === 'general_knowledge') {
        return {
            response: 'I can help with that, but my knowledge answer service is unavailable right now.',
            followUps: ['Ask a product question', 'Show popular deals', 'Open your cart'],
        };
    }

    if (turn.decision === 'clarify' && turn.ui?.surface === 'confirmation_card') {
        return {
            response: 'I can take you to checkout once you confirm.',
            followUps: ['Confirm checkout', 'Show my cart', 'Continue shopping'],
        };
    }

    if (turn.decision === 'clarify') {
        return {
            response: safeString(turn.response || 'Can you clarify what you want me to do?'),
            followUps: ['Show deals', 'Open cart', 'Track my order'],
        };
    }

    if (action?.type === 'search_products') {
        return {
            response: products.length > 0
                ? `I found ${products.length} options${action.query ? ` for ${action.query}` : ''}.`
                : `I can search${action.query ? ` for ${action.query}` : ''} and show the closest matches.`,
            followUps: ['Compare top results', 'Show cheaper options', 'Open the best match'],
        };
    }

    if (action?.type === 'select_product') {
        return {
            response: `I can open ${safeString(product?.title || 'that product')} for you.`,
            followUps: ['Add it to cart', 'Show similar products', 'Compare alternatives'],
        };
    }

    if (action?.type === 'add_to_cart') {
        return {
            response: `I can add ${safeString(product?.title || 'that product')} to your cart.`,
            followUps: ['Show my cart', 'Go to checkout', 'Keep browsing'],
        };
    }

    if (action?.type === 'remove_from_cart') {
        return {
            response: `I can remove ${safeString(product?.title || 'that item')} from your cart.`,
            followUps: ['Show my cart', 'Continue shopping', 'Go to checkout'],
        };
    }

    if (action?.type === 'navigate_to') {
        return {
            response: `I can take you to ${page || 'that page'}.`,
            followUps: page === 'cart'
                ? ['Go to checkout', 'Continue shopping', 'Open deals']
                : ['Show deals', 'Open cart', 'Track my order'],
        };
    }

    if (action?.type === 'track_order') {
        return {
            response: `I can open tracking for order ${safeString(action.orderId || turn.entities.orderId)}.`,
            followUps: ['Open support', 'Show my orders', 'Return to shopping'],
        };
    }

    if (action?.type === 'open_support') {
        return {
            response: turn.entities.orderId
                ? `I can open support for order ${turn.entities.orderId}.`
                : 'I can open support and prefill your request.',
            followUps: ['Track my order', 'Show my orders', 'Return to shopping'],
        };
    }

    return {
        response: safeString(turn.response || 'I can help with that.'),
        followUps: ['Show deals', 'Open cart', 'Track my order'],
    };
};

const buildComposerSystemPrompt = () => [
    'You are Aura AI, an autonomous ecommerce assistant.',
    'Return strict JSON only.',
    'Schema: {"response":"string","followUps":["string"]}',
    'Rules:',
    '- Keep the response concise and useful.',
    '- If the plan includes an action that will happen in the client, describe it in future tense.',
    '- Never claim an action already succeeded unless the plan explicitly says it has been executed.',
    '- If decision is clarify, ask only one clear question.',
    '- If intent is general_knowledge, answer directly and plainly.',
    '- Stay grounded in the provided products, order ids, and UI plan.',
].join('\n');

const buildComposerUserPrompt = ({ message, turn, enriched }) => {
    const planSummary = {
        intent: turn.intent,
        decision: turn.decision,
        entities: turn.entities,
        actions: turn.actions,
        ui: {
            surface: turn.ui?.surface,
            title: turn.ui?.title || '',
            productCount: Array.isArray(turn.ui?.products) ? turn.ui.products.length : 0,
            productTitle: safeString(turn.ui?.product?.title || ''),
            navigation: turn.ui?.navigation || null,
            support: turn.ui?.support || null,
            confirmation: turn.ui?.confirmation
                ? {
                    message: turn.ui.confirmation.message,
                    actionType: turn.ui.confirmation.action?.type || '',
                }
                : null,
        },
        routeTarget: enriched.routeTarget || null,
    };

    return [
        `User message: ${safeString(message)}`,
        `Plan summary: ${JSON.stringify(planSummary)}`,
        turn.intent === 'general_knowledge'
            ? 'Answer the user directly.'
            : 'Respond in a way that guides the user to the next outcome.',
        'Return JSON only.',
    ].join('\n\n');
};

const composeAssistantResponse = async ({
    message = '',
    turn = {},
    enriched = {},
}) => {
    if (!turn || typeof turn !== 'object') {
        return {
            response: 'I can help with that.',
            followUps: [],
            provider: 'local',
        };
    }

    const response = await generateStructuredResponse({
        systemPrompt: buildComposerSystemPrompt(),
        userPrompt: buildComposerUserPrompt({
            message,
            turn,
            enriched,
        }),
        temperature: turn.intent === 'general_knowledge' ? 0.25 : 0.15,
        maxTokens: turn.intent === 'general_knowledge' ? 450 : 180,
    });

    const fallback = buildDefaultResponse({ turn, enriched });
    const payload = response?.payload || {};

    return {
        response: safeString(payload.response || fallback.response),
        followUps: Array.isArray(payload.followUps)
            ? payload.followUps.map((entry) => safeString(entry)).filter(Boolean).slice(0, 4)
            : fallback.followUps,
        provider: safeString(response?.provider || 'local'),
    };
};

module.exports = {
    buildDeterministicClassification,
    classifyAssistantTurn,
    composeAssistantResponse,
    enrichAssistantContext,
    planAssistantTurn,
};

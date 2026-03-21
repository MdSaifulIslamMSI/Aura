const { generateStructuredResponse } = require('./providerRegistry');
const { getProductByIdentifier } = require('../catalogService');
const {
    cleanSearchQuery,
    extractBudget,
    mergeSearchContext,
    searchProducts,
} = require('./assistantSearchService');

const ACT_DIRECT_THRESHOLD = 0.7;
const INFER_CONFIRM_THRESHOLD = 0.4;
const MAX_CLARIFICATION_REPEATS = 1;

const PAGE_TARGETS = [
    { page: 'home', path: '/', aliases: ['home', 'homepage'] },
    { page: 'cart', path: '/cart', aliases: ['cart', 'bag', 'basket'] },
    { page: 'checkout', path: '/checkout', aliases: ['checkout', 'payment', 'pay now', 'place order'] },
    { page: 'orders', path: '/orders', aliases: ['orders', 'my orders', 'order history'] },
    { page: 'profile', path: '/profile', aliases: ['profile', 'account'] },
    { page: 'wishlist', path: '/wishlist', aliases: ['wishlist', 'favorites', 'favourites'] },
    { page: 'marketplace', path: '/marketplace', aliases: ['marketplace', 'market place'] },
    { page: 'support', path: '/profile?tab=support', aliases: ['support', 'help desk', 'customer care', 'help center'] },
    { page: 'deals', path: '/deals', aliases: ['deals', 'offers', 'discounts'] },
    { page: 'product', path: '/product', aliases: ['product', 'details', 'detail page'] },
];

const SUPPORT_PATTERN = /\b(refund|return|replace|replacement|cancel order|track|tracking|late delivery|delivery issue|damaged|defect|warranty|complaint|support|help with|issue with|problem with)\b/i;
const GENERAL_KNOWLEDGE_PATTERN = /^(?:who|what|when|where|why|how|which)\b|(?:\bmeaning of\b|\bexplain\b|\btell me about\b|\bdefine\b)/i;
const SEARCH_PATTERN = /\b(search|find|look for|show me|recommend|suggest|compare|vs|versus|buy|need|want|budget|under|below|within)\b/i;
const CART_ADD_PATTERN = /\b(add|put|place|buy)\b.*\b(cart|bag|basket)\b|\badd this\b|\bbuy this\b/i;
const CART_REMOVE_PATTERN = /\b(remove|delete|take out|drop)\b.*\b(cart|bag|basket)\b/i;
const NAVIGATION_PATTERN = /\b(open|go to|take me to|navigate|show)\b/i;
const PRODUCT_REFERENCE_PATTERN = /\b(this|that|it|selected|current)\b/i;
const SHOW_MORE_PATTERN = /\b(show more|more options|more results|next results|next page)\b/i;
const CATEGORY_BROWSE_PATTERN = /\b(open|browse|go to|take me to)\b/i;
const FILTER_REFINEMENT_PATTERN = /^(?:then|now|also|only|just)?\s*(?:under|below|less than|max|within|around|about)?\s*(?:rs\.?|inr)?\s*[\d,]+\s*k?\s*(?:price|budget)?$/i;
const PRODUCT_SEARCH_CUE_PATTERN = /\b(iphone|samsung|pixel|oppo|vivo|realme|phone|phones|laptop|laptops|headphone|headphones|earbuds|watch|tv|book|books|shoes?)\b/i;

const CATEGORY_SLUG_LOOKUP = new Map([
    ['Mobiles', 'mobiles'],
    ['Laptops', 'laptops'],
    ['Electronics', 'electronics'],
    ["Men's Fashion", "men's-fashion"],
    ["Women's Fashion", "women's-fashion"],
    ['Footwear', 'footwear'],
    ['Home & Kitchen', 'home-kitchen'],
    ['Gaming & Accessories', 'gaming'],
    ['Books', 'books'],
]);

const safeString = (value, fallback = '') => String(value === undefined || value === null ? fallback : value).trim();
const safeLower = (value, fallback = '') => safeString(value, fallback).toLowerCase();
const clamp = (value, min, max) => Math.min(Math.max(Number(value) || 0, min), max);
const titleCase = (value = '') => safeString(value)
    .replace(/[-_]/g, ' ')
    .replace(/\b\w/g, (character) => character.toUpperCase());

const toCategorySlug = (value = '') => {
    const normalized = safeString(value);
    if (!normalized) return '';
    return CATEGORY_SLUG_LOOKUP.get(normalized) || safeLower(normalized)
        .replace(/&/g, 'and')
        .replace(/['"]/g, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
};

const normalizeClarificationState = (value = {}) => ({
    fingerprint: safeString(value?.fingerprint || ''),
    count: Math.max(0, Number(value?.count || 0)),
    lastQuestion: safeString(value?.lastQuestion || ''),
});

const stripCategoryBrowseQuery = (message = '', categoryLabel = '') => cleanSearchQuery(
    safeString(message).replace(/\b(open|browse|go to|take me to)\b/gi, ' '),
    categoryLabel
);

const resolveCategoryBrowseQuery = (message = '', categoryLabel = '') => {
    const cleaned = safeString(stripCategoryBrowseQuery(message, categoryLabel));
    const normalizedCategory = safeLower(categoryLabel);
    return safeLower(cleaned) === normalizedCategory ? '' : cleaned;
};

const normalizeProductSummary = (product = {}) => {
    const id = safeString(product?.id || product?._id || '');
    if (!id) return null;

    return {
        id,
        title: safeString(product?.displayTitle || product?.title || product?.name || 'Untitled product'),
        brand: safeString(product?.brand || ''),
        category: safeString(product?.category || ''),
        price: Number(product?.price || 0),
        originalPrice: Number(product?.originalPrice || product?.price || 0),
        discountPercentage: Number(product?.discountPercentage || 0),
        image: safeString(product?.image || product?.thumbnail || ''),
        stock: Math.max(0, Number(product?.stock || 0)),
        rating: Number(product?.rating || 0),
        ratingCount: Number(product?.ratingCount || 0),
    };
};

const uniqueProducts = (products = []) => {
    const seen = new Set();
    return (Array.isArray(products) ? products : [])
        .map((product) => normalizeProductSummary(product))
        .filter(Boolean)
        .filter((product) => {
            if (seen.has(product.id)) return false;
            seen.add(product.id);
            return true;
        });
};

const extractQuantity = (message = '', fallback = 1) => {
    const match = safeString(message).match(/\b(?:qty|quantity|add|remove)\s*(\d+)\b/i)
        || safeString(message).match(/\b(\d+)\s+(?:items?|pieces?|units?)\b/i);
    const parsed = Number(match?.[1] || 0);
    return parsed > 0 ? parsed : fallback;
};

const extractOrderId = (message = '', context = {}) => safeString(
    safeString(message).match(/\b(?:order(?:\s+id)?|tracking(?:\s+id)?)\s*(?:#|no\.?|number)?\s*([a-z0-9-]{3,})\b/i)?.[1]
    || safeString(message).match(/\b#([a-z0-9-]{3,})\b/i)?.[1]
    || context?.activeOrderId
    || context?.orderId
    || ''
);

const findPageTarget = (message = '') => {
    const normalized = safeLower(message);
    return PAGE_TARGETS.find((entry) => entry.aliases.some((alias) => normalized.includes(alias))) || null;
};

const resolveSessionMemory = (context = {}) => {
    const rawMemory = context?.sessionMemory && typeof context.sessionMemory === 'object'
        ? context.sessionMemory
        : {};

    const lastResults = uniqueProducts(
        rawMemory.lastResults
        || context.visibleProducts
        || context.latestProducts
        || []
    ).slice(0, 6);

    const activeProduct = normalizeProductSummary(
        rawMemory.activeProduct
        || context.currentProduct
        || context.product
        || null
    );

    return {
        lastQuery: safeString(rawMemory.lastQuery || context.lastQuery || ''),
        lastResults,
        activeProduct,
        lastIntent: safeString(rawMemory.lastIntent || rawMemory.currentIntent || context.lastIntent || context.currentIntent || ''),
        currentIntent: safeString(rawMemory.lastIntent || rawMemory.currentIntent || context.lastIntent || context.currentIntent || ''),
        clarificationState: normalizeClarificationState(rawMemory.clarificationState || context.clarificationState || {}),
        lastActionFingerprint: safeString(rawMemory.lastActionFingerprint || context.lastActionFingerprint || ''),
        lastActionAt: Math.max(0, Number(rawMemory.lastActionAt || context.lastActionAt || 0)),
    };
};

const resolveReferencedProduct = ({ message = '', sessionMemory = {}, context = {} }) => {
    const explicitProductId = safeString(
        safeString(message).match(/\b(?:product|item)\s+([a-z0-9._-]{3,})\b/i)?.[1]
        || context?.currentProductId
        || ''
    );

    if (explicitProductId) {
        return {
            productId: explicitProductId,
            ambiguous: false,
        };
    }

    const referencesContext = PRODUCT_REFERENCE_PATTERN.test(message)
        || /\b(first one|first result|top result|best match)\b/i.test(message);

    if (!referencesContext) {
        return {
            productId: '',
            ambiguous: false,
        };
    }

    if (sessionMemory?.activeProduct?.id) {
        return {
            productId: safeString(sessionMemory.activeProduct.id),
            ambiguous: false,
        };
    }

    if (Array.isArray(sessionMemory?.lastResults) && sessionMemory.lastResults.length === 1) {
        return {
            productId: safeString(sessionMemory.lastResults[0]?.id),
            ambiguous: false,
        };
    }

    if (/\b(first one|first result|top result|best match)\b/i.test(message) && Array.isArray(sessionMemory?.lastResults) && sessionMemory.lastResults.length > 0) {
        return {
            productId: safeString(sessionMemory.lastResults[0]?.id),
            ambiguous: false,
        };
    }

    return {
        productId: '',
        ambiguous: Array.isArray(sessionMemory?.lastResults) && sessionMemory.lastResults.length > 1,
    };
};

const buildSupportPrefill = ({ message = '', orderId = '' } = {}) => ({
    category: /\b(refund|return|replace|replacement)\b/i.test(message)
        ? 'returns'
        : /\b(track|tracking|delivery|shipment|late)\b/i.test(message)
            ? 'orders'
            : /\b(payment|charged|upi|card)\b/i.test(message)
                ? 'payments'
                : 'general',
    subject: safeString(message).slice(0, 72) || 'Support request',
    body: safeString(message),
    orderId: safeString(orderId),
});

const buildDeterministicInterpretation = ({ message = '', context = {}, sessionMemory = {} }) => {
    const safeMessage = safeString(message);
    const normalized = safeLower(safeMessage);
    const pageTarget = findPageTarget(safeMessage);
    const quantity = extractQuantity(safeMessage, 1);
    const productReference = resolveReferencedProduct({
        message: safeMessage,
        sessionMemory,
        context,
    });
    const orderId = extractOrderId(safeMessage, context);
    const lastQuery = safeString(sessionMemory.lastQuery || '');
    const lastIntent = safeString(sessionMemory.lastIntent || sessionMemory.currentIntent || '');
    const showMore = SHOW_MORE_PATTERN.test(safeMessage) && Boolean(lastQuery);
    const mergedSearch = mergeSearchContext({
        message: showMore ? lastQuery : safeMessage,
        lastQuery,
        category: context?.category || '',
    });
    const categoryLabel = safeString(mergedSearch.category || '');
    const categorySlug = toCategorySlug(categoryLabel);
    const searchQuery = safeString(mergedSearch.query || cleanSearchQuery(showMore ? lastQuery : safeMessage, context?.category || '') || lastQuery || safeMessage);
    const categoryBrowseQuery = resolveCategoryBrowseQuery(safeMessage, categoryLabel);
    const categoryBrowse = Boolean(categorySlug)
        && CATEGORY_BROWSE_PATTERN.test(safeMessage)
        && !categoryBrowseQuery;
    const refinementFollowUp = Boolean(lastQuery) && (
        showMore
        || FILTER_REFINEMENT_PATTERN.test(safeMessage)
        || (lastIntent === 'product_search' && mergedSearch.usedLastQuery)
    );

    if (CART_ADD_PATTERN.test(safeMessage)) {
        return {
            intent: 'cart_action',
            entities: {
                query: lastQuery,
                productId: productReference.productId,
                quantity,
                category: categoryLabel,
                maxPrice: 0,
            },
            confidence: productReference.ambiguous ? 0.58 : 0.92,
            decision: productReference.productId ? 'act' : 'clarify',
            response: productReference.productId
                ? ''
                : productReference.ambiguous
                    ? 'Which result should I add to your cart?'
                    : 'Which product should I add to your cart?',
            meta: {
                operation: 'add',
                page: '',
                orderId: '',
                showMore: false,
                categorySlug: '',
                categoryLabel: '',
                refinementFollowUp: false,
            },
        };
    }

    if (CART_REMOVE_PATTERN.test(safeMessage)) {
        return {
            intent: 'cart_action',
            entities: {
                query: lastQuery,
                productId: productReference.productId,
                quantity,
                category: categoryLabel,
                maxPrice: 0,
            },
            confidence: productReference.ambiguous ? 0.58 : 0.9,
            decision: productReference.productId ? 'act' : 'clarify',
            response: productReference.productId
                ? ''
                : 'Which cart item should I remove?',
            meta: {
                operation: 'remove',
                page: '',
                orderId: '',
                showMore: false,
                categorySlug: '',
                categoryLabel: '',
                refinementFollowUp: false,
            },
        };
    }

    if (SUPPORT_PATTERN.test(safeMessage)) {
        return {
            intent: 'support',
            entities: {
                query: safeMessage,
                productId: productReference.productId,
                quantity: 0,
                category: '',
                maxPrice: 0,
            },
            confidence: orderId ? 0.95 : 0.86,
            decision: 'act',
            response: '',
            meta: {
                operation: '',
                page: orderId || /\b(track|tracking)\b/i.test(safeMessage) ? 'orders' : 'support',
                orderId,
                showMore: false,
                categorySlug: '',
                categoryLabel: '',
                refinementFollowUp: false,
            },
        };
    }

    if (pageTarget?.page === 'checkout') {
        return {
            intent: 'navigation',
            entities: {
                query: '',
                productId: '',
                quantity: 0,
                category: '',
                maxPrice: 0,
            },
            confidence: 0.93,
            decision: 'clarify',
            response: 'Checkout affects payment and order placement. Should I open checkout?',
            meta: {
                operation: '',
                page: 'checkout',
                orderId: '',
                showMore: false,
                categorySlug: '',
                categoryLabel: '',
                refinementFollowUp: false,
            },
        };
    }

    if (categoryBrowse) {
        return {
            intent: 'navigation',
            entities: {
                query: '',
                productId: '',
                quantity: 0,
                category: categoryLabel,
                maxPrice: 0,
            },
            confidence: 0.78,
            decision: 'act',
            response: '',
            meta: {
                operation: '',
                page: 'category',
                orderId: '',
                showMore: false,
                categorySlug,
                categoryLabel,
                refinementFollowUp: false,
            },
        };
    }

    if (pageTarget?.page === 'product' && productReference.productId) {
        return {
            intent: 'navigation',
            entities: {
                query: '',
                productId: productReference.productId,
                quantity: 0,
                category: '',
                maxPrice: 0,
            },
            confidence: 0.89,
            decision: 'act',
            response: '',
            meta: {
                operation: '',
                page: 'product',
                orderId: '',
                showMore: false,
                categorySlug: '',
                categoryLabel: '',
                refinementFollowUp: false,
            },
        };
    }

    if (pageTarget && NAVIGATION_PATTERN.test(safeMessage)) {
        return {
            intent: 'navigation',
            entities: {
                query: '',
                productId: productReference.productId,
                quantity: 0,
                category: '',
                maxPrice: 0,
            },
            confidence: 0.91,
            decision: 'act',
            response: '',
            meta: {
                operation: '',
                page: pageTarget.page,
                orderId,
                showMore: false,
                categorySlug: '',
                categoryLabel: '',
                refinementFollowUp: false,
            },
        };
    }

    if (
        showMore
        || refinementFollowUp
        || SEARCH_PATTERN.test(safeMessage)
        || mergedSearch.maxPrice > 0
        || PRODUCT_SEARCH_CUE_PATTERN.test(normalized)
        || (Boolean(categoryLabel) && Boolean(cleanSearchQuery(safeMessage, categoryLabel)))
    ) {
        return {
            intent: 'product_search',
            entities: {
                query: searchQuery || lastQuery || safeMessage,
                productId: '',
                quantity: 0,
                category: categoryLabel,
                maxPrice: mergedSearch.maxPrice,
            },
            confidence: showMore
                ? 0.9
                : refinementFollowUp
                    ? 0.66
                    : PRODUCT_SEARCH_CUE_PATTERN.test(normalized)
                        ? 0.84
                        : Boolean(categoryLabel)
                            ? 0.58
                            : 0.5,
            decision: searchQuery || lastQuery ? 'act' : 'clarify',
            response: '',
            meta: {
                operation: '',
                page: '',
                orderId: '',
                showMore,
                categorySlug,
                categoryLabel,
                refinementFollowUp,
            },
        };
    }

    if (GENERAL_KNOWLEDGE_PATTERN.test(safeMessage) && !SEARCH_PATTERN.test(safeMessage)) {
        return {
            intent: 'general_knowledge',
            entities: {
                query: safeMessage,
                productId: '',
                quantity: 0,
                category: '',
                maxPrice: 0,
            },
            confidence: 0.76,
            decision: 'respond',
            response: '',
            meta: {
                operation: '',
                page: '',
                orderId: '',
                showMore: false,
                categorySlug: '',
                categoryLabel: '',
                refinementFollowUp: false,
            },
        };
    }

    return {
        intent: 'unclear',
        entities: {
            query: safeMessage,
            productId: '',
            quantity: 0,
            category: categoryLabel,
            maxPrice: mergedSearch.maxPrice,
        },
        confidence: categoryLabel ? 0.36 : 0.28,
        decision: 'clarify',
        response: '',
        meta: {
            operation: '',
            page: '',
            orderId: '',
            showMore: false,
            categorySlug,
            categoryLabel,
            refinementFollowUp,
        },
    };
};

const buildInterpreterSystemPrompt = () => [
    'You are an AI assistant for an e-commerce app.',
    'You MUST return ONLY valid JSON.',
    'Format:',
    '{"intent":"general_knowledge | product_search | navigation | cart_action | unclear","entities":{"query":"","productId":"","category":"","maxPrice":0},"confidence":0.0,"response":""}',
    'Rules:',
    '- NEVER return plain text.',
    '- Extract intent and entities clearly.',
    '- If unsure, set intent = "unclear".',
    '- Confidence must be between 0 and 1.',
    '- general_knowledge is only for non-commerce factual or explanatory questions.',
    '- product_search is only for shopping discovery, recommendations, comparisons, budgets, or more results.',
    '- navigation is for opening app pages or browsing a product category.',
    '- cart_action is only for adding or removing a product from cart.',
    '- Never invent productId. Only use it when the user explicitly names it or session memory makes it unambiguous.',
].join('\n');

const buildInterpreterUserPrompt = ({
    message = '',
    deterministic = {},
    sessionMemory = {},
}) => {
    const summary = {
        lastQuery: safeString(sessionMemory?.lastQuery || ''),
        activeProduct: sessionMemory?.activeProduct
            ? {
                id: safeString(sessionMemory.activeProduct.id),
                title: safeString(sessionMemory.activeProduct.title),
            }
            : null,
        lastResults: Array.isArray(sessionMemory?.lastResults)
            ? sessionMemory.lastResults.slice(0, 4).map((product) => ({
                id: safeString(product?.id),
                title: safeString(product?.title),
            }))
            : [],
        lastIntent: safeString(sessionMemory?.lastIntent || sessionMemory?.currentIntent || ''),
    };

    return [
        `User message: ${safeString(message)}`,
        `Session memory: ${JSON.stringify(summary)}`,
        `Deterministic hint: ${JSON.stringify({
            intent: deterministic.intent,
            entities: deterministic.entities,
            confidence: deterministic.confidence,
        })}`,
        'Return JSON only.',
    ].join('\n\n');
};

const normalizeModelInterpretation = (payload = {}, fallback = {}) => ({
    intent: ['product_search', 'general_knowledge', 'cart_action', 'navigation', 'unclear'].includes(safeString(payload?.intent))
        ? safeString(payload.intent)
        : safeString(fallback.intent || 'unclear'),
    entities: {
        query: safeString(payload?.entities?.query || fallback?.entities?.query || ''),
        productId: safeString(payload?.entities?.productId || fallback?.entities?.productId || ''),
        category: safeString(payload?.entities?.category || fallback?.entities?.category || ''),
        maxPrice: Math.max(0, Number(payload?.entities?.maxPrice ?? fallback?.entities?.maxPrice ?? 0) || 0),
        quantity: Math.max(0, Number(payload?.entities?.quantity ?? fallback?.entities?.quantity ?? 0) || 0),
    },
    confidence: clamp(payload?.confidence ?? fallback?.confidence ?? 0, 0, 1),
    response: safeString(payload?.response || fallback?.response || ''),
});

const shouldUseModel = (deterministic = {}) => (
    deterministic.intent === 'general_knowledge'
    || deterministic.intent === 'unclear'
    || Number(deterministic.confidence || 0) < ACT_DIRECT_THRESHOLD
);

const interpretWithModel = async ({ message = '', sessionMemory = {}, deterministic = {} }) => {
    const response = await generateStructuredResponse({
        systemPrompt: buildInterpreterSystemPrompt(),
        userPrompt: buildInterpreterUserPrompt({
            message,
            deterministic,
            sessionMemory,
        }),
        temperature: 0.08,
        maxTokens: 320,
    });

    if (!response?.payload || response.provider === 'local') {
        return {
            interpretation: normalizeModelInterpretation({}, deterministic),
            provider: 'local',
        };
    }

    return {
        interpretation: normalizeModelInterpretation(response.payload, deterministic),
        provider: response.provider,
    };
};

const mergeInterpretations = (deterministic = {}, model = {}) => {
    const deterministicConfidence = Number(deterministic.confidence || 0);
    const modelConfidence = Number(model.confidence || 0);

    if (deterministic.intent === 'support') {
        return deterministic;
    }

    if (deterministicConfidence >= 0.88 && deterministic.intent !== 'general_knowledge') {
        return deterministic;
    }

    if (!model.intent || model.intent === 'unclear') {
        return deterministic;
    }

    if (deterministic.intent === model.intent) {
        return {
            ...model,
            entities: {
                query: safeString(model.entities?.query || deterministic.entities?.query || ''),
                productId: safeString(model.entities?.productId || deterministic.entities?.productId || ''),
                category: safeString(model.entities?.category || deterministic.entities?.category || ''),
                maxPrice: Math.max(0, Number(model.entities?.maxPrice || deterministic.entities?.maxPrice || 0)),
                quantity: Math.max(0, Number(model.entities?.quantity || deterministic.entities?.quantity || 0)),
            },
            confidence: Math.max(modelConfidence, deterministicConfidence),
            response: safeString(model.response || deterministic.response || ''),
        };
    }

    if (modelConfidence >= deterministicConfidence + 0.12) {
        return model;
    }

    return deterministic;
};

const buildKnowledgeFallback = (message = '') => ({
    response: `I need the language model provider to answer "${safeString(message)}" accurately, and that provider is unavailable right now.`,
    provider: 'local',
});

const buildKnowledgePrompt = (message = '') => ({
    systemPrompt: [
        'You answer general knowledge questions for a commerce assistant.',
        'Return strict JSON only.',
        'Schema: {"answer":"string"}',
        'Rules:',
        '- Answer directly and concisely.',
        '- Do not mention products, shopping UI, or cart behavior.',
        '- If the answer is uncertain, say so plainly instead of guessing.',
    ].join('\n'),
    userPrompt: `Question: ${safeString(message)}\n\nReturn JSON only.`,
});

const answerGeneralKnowledge = async (message = '') => {
    const prompt = buildKnowledgePrompt(message);
    const response = await generateStructuredResponse({
        systemPrompt: prompt.systemPrompt,
        userPrompt: prompt.userPrompt,
        temperature: 0.18,
        maxTokens: 260,
    });

    if (!response?.payload || response.provider === 'local') {
        return buildKnowledgeFallback(message);
    }

    return {
        response: safeString(response.payload?.answer || ''),
        provider: response.provider,
    };
};

const getDecisionBand = (confidence = 0) => {
    const normalized = Number(confidence || 0);
    if (normalized >= ACT_DIRECT_THRESHOLD) return 'act';
    if (normalized >= INFER_CONFIRM_THRESHOLD) return 'infer';
    return 'clarify';
};

const buildClarificationFingerprint = ({
    message = '',
    intent = '',
    response = '',
    followUps = [],
} = {}) => [
    safeLower(message),
    safeLower(intent),
    safeLower(response),
    (Array.isArray(followUps) ? followUps : []).map((entry) => safeLower(entry)).join('|'),
].filter(Boolean).join('::').slice(0, 240);

const buildNextClarificationState = ({
    current = {},
    fingerprint = '',
    question = '',
} = {}) => ({
    fingerprint: safeString(fingerprint),
    count: safeString(fingerprint) && safeString(current?.fingerprint) === safeString(fingerprint)
        ? Math.max(0, Number(current?.count || 0)) + 1
        : 1,
    lastQuestion: safeString(question),
});

const buildCategoryFollowUps = (categoryLabel = '') => {
    const normalized = safeLower(categoryLabel);
    if (!normalized) return [];
    return [`Browse ${normalized}`, `Search ${normalized} products`];
};

const buildSessionMemory = ({
    current = {},
    assistantTurn = {},
    products = [],
    activeProduct = null,
    clarificationState = null,
    lastActionFingerprint,
    lastActionAt,
}) => {
    const nextIntent = safeString(assistantTurn?.intent || current?.lastIntent || current?.currentIntent || '');

    return {
        lastQuery: safeString(
            assistantTurn?.intent === 'product_search'
                ? assistantTurn?.entities?.query
                : current?.lastQuery || ''
        ),
        lastResults: assistantTurn?.intent === 'product_search'
            ? uniqueProducts(products).slice(0, 6)
            : uniqueProducts(current?.lastResults || []).slice(0, 6),
        activeProduct: normalizeProductSummary(activeProduct || current?.activeProduct || null),
        lastIntent: nextIntent,
        currentIntent: nextIntent,
        clarificationState: clarificationState
            ? normalizeClarificationState(clarificationState)
            : normalizeClarificationState(current?.clarificationState || {}),
        lastActionFingerprint: safeString((lastActionFingerprint ?? current?.lastActionFingerprint) || ''),
        lastActionAt: Math.max(0, Number((lastActionAt ?? current?.lastActionAt) || 0)),
    };
};

const buildFollowUps = ({
    intent = '',
    products = [],
    actionType = '',
    hasMoreContext = false,
    categoryLabel = '',
    inferred = false,
    existing = [],
}) => {
    const next = Array.isArray(existing) ? existing.map((entry) => safeString(entry)).filter(Boolean) : [];

    if (intent === 'product_search') {
        if (products.length > 1) next.push('show more');
        if (products.length === 1) next.push('add this to cart');
        if (inferred && categoryLabel) next.unshift(`Browse ${safeLower(categoryLabel)}`);
        return [...new Set(next)].slice(0, 4);
    }

    if (intent === 'cart_action') {
        next.push('show my cart', 'go to checkout');
        return [...new Set(next)].slice(0, 3);
    }

    if (intent === 'support') {
        next.push(hasMoreContext ? 'open support' : 'show my orders');
        return [...new Set(next)].slice(0, 3);
    }

    if (intent === 'navigation' && actionType === 'checkout') {
        next.push('show my cart');
        return [...new Set(next)].slice(0, 3);
    }

    if (intent === 'navigation' && inferred && categoryLabel) {
        next.push(`Search ${safeLower(categoryLabel)} products`);
    }

    return [...new Set(next)].slice(0, 4);
};

const createAssistantTurn = ({
    intent = 'unclear',
    entities = {},
    confidence = 0,
    decision = 'clarify',
    response = '',
    actions = [],
    ui = {},
    followUps = [],
    sessionMemory = {},
}) => ({
    intent: safeString(intent || 'unclear'),
    entities: {
        query: safeString(entities?.query || ''),
        productId: safeString(entities?.productId || ''),
        category: safeString(entities?.category || ''),
        maxPrice: Math.max(0, Number(entities?.maxPrice || 0)),
        quantity: Math.max(0, Number(entities?.quantity) || 0),
    },
    confidence: clamp(confidence, 0, 1),
    decision: safeString(decision || 'clarify'),
    response: safeString(response),
    actions: Array.isArray(actions) ? actions.filter(Boolean).slice(0, 2) : [],
    ui: {
        surface: safeString(ui?.surface || 'plain_answer'),
        products: uniqueProducts(ui?.products || []).slice(0, 6),
        product: normalizeProductSummary(ui?.product || null),
        cartSummary: ui?.cartSummary || null,
        confirmation: ui?.confirmation || null,
        navigation: ui?.navigation || null,
        support: ui?.support || null,
    },
    followUps: Array.isArray(followUps) ? followUps.map((entry) => safeString(entry)).filter(Boolean).slice(0, 4) : [],
    sessionMemory,
    contextPatch: {
        sessionMemory,
    },
    safetyFlags: [],
});

const buildClarificationPayload = ({
    message = '',
    interpretation = {},
    sessionMemory = {},
} = {}) => {
    const categoryLabel = safeString(interpretation?.entities?.category || interpretation?.meta?.categoryLabel || '');
    const lastQuery = safeString(sessionMemory?.lastQuery || '');
    const lastResults = uniqueProducts(sessionMemory?.lastResults || []).slice(0, 4);
    const operation = safeString(interpretation?.meta?.operation || '');
    const page = safeString(interpretation?.meta?.page || '');

    if (interpretation?.intent === 'cart_action' && !safeString(interpretation?.entities?.productId || '')) {
        if (lastResults.length > 1) {
            return {
                response: operation === 'remove'
                    ? 'Pick the cart item you want me to remove.'
                    : 'Pick the product you want me to add to your cart.',
                followUps: [],
                ui: {
                    surface: 'product_results',
                    products: lastResults,
                },
            };
        }

        return {
            response: operation === 'remove'
                ? 'Which cart item should I remove?'
                : 'Which product should I add to your cart?',
            followUps: [],
            ui: {
                surface: 'plain_answer',
            },
        };
    }

    if (interpretation?.intent === 'navigation' && page === 'product' && !safeString(interpretation?.entities?.productId || '')) {
        return {
            response: lastResults.length > 1 ? 'Pick the product you want me to open.' : 'Which product should I open?',
            followUps: [],
            ui: {
                surface: lastResults.length > 1 ? 'product_results' : 'plain_answer',
                products: lastResults,
            },
        };
    }

    if (categoryLabel) {
        return {
            response: `Do you mean browse ${safeLower(categoryLabel)} or search products in ${safeLower(categoryLabel)}?`,
            followUps: buildCategoryFollowUps(categoryLabel),
            ui: {
                surface: 'plain_answer',
            },
        };
    }

    if (lastQuery && safeString(sessionMemory?.lastIntent || sessionMemory?.currentIntent || '') === 'product_search') {
        return {
            response: `Do you want more results for ${lastQuery} or a tighter budget?`,
            followUps: ['show more', `Search ${lastQuery}`],
            ui: {
                surface: 'plain_answer',
            },
        };
    }

    return {
        response: 'Can you clarify what you want?',
        followUps: [],
        ui: {
            surface: 'plain_answer',
        },
    };
};

const escalateClarificationPayload = (clarification = {}) => ({
    ...clarification,
    response: clarification?.ui?.surface === 'product_results'
        ? 'Choose one of these options so I can continue.'
        : Array.isArray(clarification?.followUps) && clarification.followUps.length > 0
            ? 'Pick one of these options so I can continue.'
            : safeString(clarification?.response || ''),
});

const forceInferenceFromContext = ({
    message = '',
    interpretation = {},
    sessionMemory = {},
} = {}) => {
    const categoryLabel = safeString(interpretation?.entities?.category || interpretation?.meta?.categoryLabel || '');
    const categorySlug = safeString(interpretation?.meta?.categorySlug || toCategorySlug(categoryLabel));
    const activeProductId = safeString(sessionMemory?.activeProduct?.id || '');
    const singleResultId = Array.isArray(sessionMemory?.lastResults) && sessionMemory.lastResults.length === 1
        ? safeString(sessionMemory.lastResults[0]?.id)
        : '';
    const lastQuery = safeString(sessionMemory?.lastQuery || '');

    if (interpretation.intent === 'cart_action' && !safeString(interpretation?.entities?.productId || '')) {
        const resolvedProductId = activeProductId || singleResultId;
        if (resolvedProductId) {
            return {
                ...interpretation,
                confidence: Math.max(INFER_CONFIRM_THRESHOLD, Number(interpretation.confidence || 0)),
                entities: {
                    ...interpretation.entities,
                    productId: resolvedProductId,
                },
            };
        }
    }

    if (interpretation.intent === 'navigation' && safeString(interpretation?.meta?.page || '') === 'product' && !safeString(interpretation?.entities?.productId || '')) {
        const resolvedProductId = activeProductId || singleResultId;
        if (resolvedProductId) {
            return {
                ...interpretation,
                confidence: Math.max(INFER_CONFIRM_THRESHOLD, Number(interpretation.confidence || 0)),
                entities: {
                    ...interpretation.entities,
                    productId: resolvedProductId,
                },
            };
        }
    }

    if (
        (interpretation.intent === 'unclear' || interpretation.intent === 'product_search')
        && categorySlug
        && CATEGORY_BROWSE_PATTERN.test(message)
        && !resolveCategoryBrowseQuery(message, categoryLabel)
    ) {
        return {
            ...interpretation,
            intent: 'navigation',
            confidence: Math.max(INFER_CONFIRM_THRESHOLD, Number(interpretation.confidence || 0)),
            entities: {
                ...interpretation.entities,
                category: categoryLabel,
            },
            meta: {
                ...interpretation.meta,
                page: 'category',
                categorySlug,
                categoryLabel,
            },
        };
    }

    if ((interpretation.intent === 'unclear' || interpretation.intent === 'product_search') && lastQuery) {
        const merged = mergeSearchContext({
            message,
            lastQuery,
            category: categoryLabel,
        });

        return {
            ...interpretation,
            intent: 'product_search',
            confidence: Math.max(INFER_CONFIRM_THRESHOLD, Number(interpretation.confidence || 0)),
            entities: {
                ...interpretation.entities,
                query: safeString(merged.query || lastQuery),
                category: safeString(merged.category || categoryLabel),
                maxPrice: Math.max(0, Number(merged.maxPrice || interpretation?.entities?.maxPrice || 0)),
            },
            meta: {
                ...interpretation.meta,
                categorySlug: toCategorySlug(merged.category || categoryLabel),
                categoryLabel: safeString(merged.category || categoryLabel),
                showMore: Boolean(interpretation?.meta?.showMore),
            },
        };
    }

    return null;
};

const executeDecision = async ({
    message = '',
    interpretation = {},
    context = {},
    sessionMemory = {},
}) => {
    let workingInterpretation = {
        ...interpretation,
        entities: {
            query: safeString(interpretation?.entities?.query || ''),
            productId: safeString(interpretation?.entities?.productId || ''),
            category: safeString(interpretation?.entities?.category || ''),
            maxPrice: Math.max(0, Number(interpretation?.entities?.maxPrice || 0)),
            quantity: Math.max(0, Number(interpretation?.entities?.quantity || 0)),
        },
        meta: interpretation?.meta || {},
    };
    let band = getDecisionBand(workingInterpretation.confidence);
    const provider = safeString(workingInterpretation.provider || 'local');

    if (band === 'clarify' || workingInterpretation.intent === 'unclear') {
        const clarification = buildClarificationPayload({
            message,
            interpretation: workingInterpretation,
            sessionMemory,
        });
        const fingerprint = buildClarificationFingerprint({
            message,
            intent: workingInterpretation.intent,
            response: clarification.response,
            followUps: clarification.followUps,
        });
        const nextClarificationState = buildNextClarificationState({
            current: sessionMemory?.clarificationState || {},
            fingerprint,
            question: clarification.response,
        });

        if (nextClarificationState.count > MAX_CLARIFICATION_REPEATS) {
            const forcedInterpretation = forceInferenceFromContext({
                message,
                interpretation: workingInterpretation,
                sessionMemory,
            });

            if (forcedInterpretation) {
                workingInterpretation = forcedInterpretation;
                band = getDecisionBand(Math.max(forcedInterpretation.confidence, INFER_CONFIRM_THRESHOLD));
            } else {
                const escalatedClarification = escalateClarificationPayload(clarification);
                const assistantTurn = createAssistantTurn({
                    intent: safeString(workingInterpretation.intent || 'unclear'),
                    entities: workingInterpretation.entities,
                    confidence: workingInterpretation.confidence,
                    decision: 'clarify',
                    response: escalatedClarification.response,
                    ui: escalatedClarification.ui,
                    followUps: escalatedClarification.followUps,
                    sessionMemory: buildSessionMemory({
                        current: sessionMemory,
                        assistantTurn: workingInterpretation,
                        clarificationState: buildNextClarificationState({
                            current: sessionMemory?.clarificationState || {},
                            fingerprint: buildClarificationFingerprint({
                                message,
                                intent: workingInterpretation.intent,
                                response: escalatedClarification.response,
                                followUps: escalatedClarification.followUps,
                            }),
                            question: escalatedClarification.response,
                        }),
                    }),
                });

                return {
                    answer: assistantTurn.response,
                    assistantTurn,
                    products: uniqueProducts(escalatedClarification?.ui?.products || []).slice(0, 6),
                    followUps: assistantTurn.followUps,
                    provider,
                };
            }
        } else {
            const assistantTurn = createAssistantTurn({
                intent: safeString(workingInterpretation.intent || 'unclear'),
                entities: workingInterpretation.entities,
                confidence: workingInterpretation.confidence,
                decision: 'clarify',
                response: clarification.response,
                ui: clarification.ui,
                followUps: clarification.followUps,
                sessionMemory: buildSessionMemory({
                    current: sessionMemory,
                    assistantTurn: workingInterpretation,
                    clarificationState: nextClarificationState,
                }),
            });

            return {
                answer: assistantTurn.response,
                assistantTurn,
                products: uniqueProducts(clarification?.ui?.products || []).slice(0, 6),
                followUps: assistantTurn.followUps,
                provider,
            };
        }
    }

    if (workingInterpretation.intent === 'general_knowledge') {
        const knowledge = await answerGeneralKnowledge(message);
        const assistantTurn = createAssistantTurn({
            intent: 'general_knowledge',
            entities: workingInterpretation.entities,
            confidence: workingInterpretation.confidence,
            decision: 'respond',
            response: knowledge.response || workingInterpretation.response,
            ui: {
                surface: 'plain_answer',
            },
            followUps: [],
            sessionMemory: buildSessionMemory({
                current: sessionMemory,
                assistantTurn: workingInterpretation,
                clarificationState: {},
            }),
        });

        return {
            answer: assistantTurn.response,
            assistantTurn,
            products: [],
            followUps: [],
            provider: safeString(knowledge.provider || provider),
        };
    }

    if (workingInterpretation.intent === 'product_search') {
        const categoryLabel = safeString(workingInterpretation.entities?.category || workingInterpretation.meta?.categoryLabel || '');
        const excludeIds = workingInterpretation.meta?.showMore
            ? (sessionMemory?.lastResults || []).map((product) => safeString(product?.id)).filter(Boolean)
            : [];
        const search = await searchProducts({
            query: workingInterpretation.entities?.query,
            category: categoryLabel || context?.category || '',
            maxPrice: Math.max(0, Number(workingInterpretation.entities?.maxPrice || extractBudget(message) || 0)),
            excludeIds,
            limit: 6,
        });

        const products = uniqueProducts(search.products).slice(0, 6);
        const inferred = band === 'infer';

        if (products.length === 0) {
            const response = `I couldn't find relevant products for ${safeString(search.query || workingInterpretation.entities?.query || 'that search')}. Try a more specific product name or budget.`;
            const followUps = categoryLabel ? buildCategoryFollowUps(categoryLabel) : [];
            const fingerprint = buildClarificationFingerprint({
                message,
                intent: 'product_search',
                response,
                followUps,
            });
            const nextClarificationState = buildNextClarificationState({
                current: sessionMemory?.clarificationState || {},
                fingerprint,
                question: response,
            });

            const assistantTurn = createAssistantTurn({
                intent: 'product_search',
                entities: {
                    ...workingInterpretation.entities,
                    query: safeString(search.query || workingInterpretation.entities?.query || ''),
                    category: safeString(search.category || categoryLabel),
                    maxPrice: Math.max(0, Number(search.maxPrice || workingInterpretation.entities?.maxPrice || 0)),
                },
                confidence: workingInterpretation.confidence,
                decision: 'clarify',
                response,
                ui: {
                    surface: 'plain_answer',
                },
                followUps,
                sessionMemory: buildSessionMemory({
                    current: sessionMemory,
                    assistantTurn: {
                        ...workingInterpretation,
                        entities: {
                            ...workingInterpretation.entities,
                            query: safeString(search.query || workingInterpretation.entities?.query || ''),
                            category: safeString(search.category || categoryLabel),
                            maxPrice: Math.max(0, Number(search.maxPrice || workingInterpretation.entities?.maxPrice || 0)),
                        },
                    },
                    clarificationState: nextClarificationState,
                }),
            });

            return {
                answer: assistantTurn.response,
                assistantTurn,
                products: [],
                followUps: assistantTurn.followUps,
                provider,
            };
        }

        const assistantTurn = createAssistantTurn({
            intent: 'product_search',
            entities: {
                ...workingInterpretation.entities,
                query: safeString(search.query || workingInterpretation.entities?.query || ''),
                category: safeString(search.category || categoryLabel),
                maxPrice: Math.max(0, Number(search.maxPrice || workingInterpretation.entities?.maxPrice || 0)),
            },
            confidence: workingInterpretation.confidence,
            decision: 'respond',
            response: search.usedClosestMatch
                ? `No exact match${search.maxPrice ? ` under Rs ${Number(search.maxPrice).toLocaleString('en-IN')}` : ''}. Showing closest results.`
                : inferred
                    ? `Showing results based on your request for ${safeString(search.query || workingInterpretation.entities?.query || 'your search')}.`
                    : `Found ${products.length} relevant result${products.length === 1 ? '' : 's'} for ${safeString(search.query || workingInterpretation.entities?.query || 'your search')}.`,
            ui: {
                surface: products.length > 1 ? 'product_results' : products.length === 1 ? 'product_focus' : 'plain_answer',
                products,
                product: products.length === 1 ? products[0] : null,
            },
            followUps: buildFollowUps({
                intent: 'product_search',
                products,
                categoryLabel: safeString(search.category || categoryLabel),
                inferred,
            }),
            sessionMemory: buildSessionMemory({
                current: sessionMemory,
                assistantTurn: {
                    ...workingInterpretation,
                    entities: {
                        ...workingInterpretation.entities,
                        query: safeString(search.query || workingInterpretation.entities?.query || ''),
                        category: safeString(search.category || categoryLabel),
                        maxPrice: Math.max(0, Number(search.maxPrice || workingInterpretation.entities?.maxPrice || 0)),
                    },
                },
                products,
                activeProduct: products.length === 1 ? products[0] : null,
                clarificationState: {},
            }),
        });

        return {
            answer: assistantTurn.response,
            assistantTurn,
            products,
            followUps: assistantTurn.followUps,
            provider,
        };
    }

    if (workingInterpretation.intent === 'cart_action') {
        const productId = safeString(workingInterpretation.entities?.productId || '');
        const operation = safeString(workingInterpretation.meta?.operation || 'add');
        if (!productId) {
            const clarification = buildClarificationPayload({
                message,
                interpretation: workingInterpretation,
                sessionMemory,
            });
            const fingerprint = buildClarificationFingerprint({
                message,
                intent: 'cart_action',
                response: clarification.response,
                followUps: clarification.followUps,
            });
            const nextClarificationState = buildNextClarificationState({
                current: sessionMemory?.clarificationState || {},
                fingerprint,
                question: clarification.response,
            });

            if (nextClarificationState.count > MAX_CLARIFICATION_REPEATS) {
                const forcedInterpretation = forceInferenceFromContext({
                    message,
                    interpretation: workingInterpretation,
                    sessionMemory,
                });

                if (forcedInterpretation) {
                    workingInterpretation = forcedInterpretation;
                } else {
                    const escalatedClarification = escalateClarificationPayload(clarification);
                    const assistantTurn = createAssistantTurn({
                        intent: 'cart_action',
                        entities: workingInterpretation.entities,
                        confidence: workingInterpretation.confidence,
                        decision: 'clarify',
                        response: escalatedClarification.response,
                        ui: escalatedClarification.ui,
                        followUps: escalatedClarification.followUps,
                        sessionMemory: buildSessionMemory({
                            current: sessionMemory,
                            assistantTurn: workingInterpretation,
                            clarificationState: buildNextClarificationState({
                                current: sessionMemory?.clarificationState || {},
                                fingerprint: buildClarificationFingerprint({
                                    message,
                                    intent: 'cart_action',
                                    response: escalatedClarification.response,
                                    followUps: escalatedClarification.followUps,
                                }),
                                question: escalatedClarification.response,
                            }),
                        }),
                    });

                    return {
                        answer: assistantTurn.response,
                        assistantTurn,
                        products: uniqueProducts(escalatedClarification?.ui?.products || []).slice(0, 6),
                        followUps: assistantTurn.followUps,
                        provider,
                    };
                }
            }

            if (!safeString(workingInterpretation.entities?.productId || '')) {
                const assistantTurn = createAssistantTurn({
                    intent: 'cart_action',
                    entities: workingInterpretation.entities,
                    confidence: workingInterpretation.confidence,
                    decision: 'clarify',
                    response: clarification.response,
                    ui: clarification.ui,
                    followUps: clarification.followUps,
                    sessionMemory: buildSessionMemory({
                        current: sessionMemory,
                        assistantTurn: workingInterpretation,
                        clarificationState: nextClarificationState,
                    }),
                });

                return {
                    answer: assistantTurn.response,
                    assistantTurn,
                    products: uniqueProducts(clarification?.ui?.products || []).slice(0, 6),
                    followUps: assistantTurn.followUps,
                    provider,
                };
            }
        }

        const resolvedProductId = safeString(workingInterpretation.entities?.productId || productId);
        const product = await getProductByIdentifier(resolvedProductId).catch(() => null);
        const action = {
            type: operation === 'remove' ? 'remove_from_cart' : 'add_to_cart',
            productId: resolvedProductId,
            quantity: Math.max(1, Number(workingInterpretation.entities?.quantity || 1)),
            reason: 'validated_cart_action',
        };
        const assistantTurn = createAssistantTurn({
            intent: 'cart_action',
            entities: {
                ...workingInterpretation.entities,
                productId: resolvedProductId,
                quantity: Math.max(1, Number(workingInterpretation.entities?.quantity || 1)),
            },
            confidence: workingInterpretation.confidence,
            decision: 'act',
            response: '',
            actions: [action],
            ui: {
                surface: 'cart_summary',
                product,
                products: product ? [product] : [],
                cartSummary: context?.cartSummary || null,
            },
            followUps: buildFollowUps({
                intent: 'cart_action',
            }),
            sessionMemory: buildSessionMemory({
                current: sessionMemory,
                assistantTurn: workingInterpretation,
                activeProduct: product || sessionMemory.activeProduct,
                clarificationState: {},
            }),
        });

        return {
            answer: assistantTurn.response,
            assistantTurn,
            products: product ? [normalizeProductSummary(product)] : [],
            followUps: assistantTurn.followUps,
            provider,
        };
    }

    if (workingInterpretation.intent === 'navigation') {
        const page = safeString(workingInterpretation.meta?.page || '');
        const path = PAGE_TARGETS.find((entry) => entry.page === page)?.path || '/';
        const params = {};
        const inferred = band === 'infer';
        const categoryLabel = safeString(workingInterpretation.entities?.category || workingInterpretation.meta?.categoryLabel || '');

        if (page === 'product') {
            const productId = safeString(workingInterpretation.entities?.productId || '');
            if (!productId) {
                const clarification = buildClarificationPayload({
                    message,
                    interpretation: workingInterpretation,
                    sessionMemory,
                });
                const fingerprint = buildClarificationFingerprint({
                    message,
                    intent: 'navigation',
                    response: clarification.response,
                    followUps: clarification.followUps,
                });
                const nextClarificationState = buildNextClarificationState({
                    current: sessionMemory?.clarificationState || {},
                    fingerprint,
                    question: clarification.response,
                });

                if (nextClarificationState.count > MAX_CLARIFICATION_REPEATS) {
                    const forcedInterpretation = forceInferenceFromContext({
                        message,
                        interpretation: workingInterpretation,
                        sessionMemory,
                    });

                    if (forcedInterpretation) {
                        workingInterpretation = forcedInterpretation;
                    } else {
                        const escalatedClarification = escalateClarificationPayload(clarification);
                        const assistantTurn = createAssistantTurn({
                            intent: 'navigation',
                            entities: workingInterpretation.entities,
                            confidence: workingInterpretation.confidence,
                            decision: 'clarify',
                            response: escalatedClarification.response,
                            ui: escalatedClarification.ui,
                            followUps: escalatedClarification.followUps,
                            sessionMemory: buildSessionMemory({
                                current: sessionMemory,
                                assistantTurn: workingInterpretation,
                                clarificationState: buildNextClarificationState({
                                    current: sessionMemory?.clarificationState || {},
                                    fingerprint: buildClarificationFingerprint({
                                        message,
                                        intent: 'navigation',
                                        response: escalatedClarification.response,
                                        followUps: escalatedClarification.followUps,
                                    }),
                                    question: escalatedClarification.response,
                                }),
                            }),
                        });

                        return {
                            answer: assistantTurn.response,
                            assistantTurn,
                            products: uniqueProducts(escalatedClarification?.ui?.products || []).slice(0, 6),
                            followUps: assistantTurn.followUps,
                            provider,
                        };
                    }
                }

                if (!safeString(workingInterpretation.entities?.productId || '')) {
                    const assistantTurn = createAssistantTurn({
                        intent: 'navigation',
                        entities: workingInterpretation.entities,
                        confidence: workingInterpretation.confidence,
                        decision: 'clarify',
                        response: clarification.response,
                        ui: clarification.ui,
                        followUps: clarification.followUps,
                        sessionMemory: buildSessionMemory({
                            current: sessionMemory,
                            assistantTurn: workingInterpretation,
                            clarificationState: nextClarificationState,
                        }),
                    });

                    return {
                        answer: assistantTurn.response,
                        assistantTurn,
                        products: uniqueProducts(clarification?.ui?.products || []).slice(0, 6),
                        followUps: assistantTurn.followUps,
                        provider,
                    };
                }
            }

            params.productId = safeString(workingInterpretation.entities?.productId || productId);
        }

        if (page === 'category') {
            const categorySlug = safeString(workingInterpretation.meta?.categorySlug || toCategorySlug(categoryLabel));
            const categoryPath = categorySlug ? `/category/${categorySlug}` : '/products';
            const action = {
                type: 'navigate_to',
                page: 'category',
                params: {
                    category: categorySlug,
                },
                reason: 'validated_category_navigation',
            };
            const assistantTurn = createAssistantTurn({
                intent: 'navigation',
                entities: workingInterpretation.entities,
                confidence: workingInterpretation.confidence,
                decision: 'act',
                response: '',
                actions: [action],
                ui: {
                    surface: 'navigation_notice',
                    navigation: {
                        page: 'category',
                        path: categoryPath,
                        params: {
                            category: categorySlug,
                        },
                    },
                },
                followUps: buildFollowUps({
                    intent: 'navigation',
                    categoryLabel,
                    inferred,
                }),
                sessionMemory: buildSessionMemory({
                    current: sessionMemory,
                    assistantTurn: workingInterpretation,
                    clarificationState: {},
                }),
            });

            return {
                answer: assistantTurn.response,
                assistantTurn,
                products: [],
                followUps: assistantTurn.followUps,
                provider,
            };
        }

        if (page === 'checkout') {
            const confirmationAction = {
                type: 'navigate_to',
                page: 'checkout',
                params: {},
                requiresConfirmation: true,
                reason: 'checkout_navigation_confirmation',
            };
            const assistantTurn = createAssistantTurn({
                intent: 'navigation',
                entities: workingInterpretation.entities,
                confidence: workingInterpretation.confidence,
                decision: 'clarify',
                response: 'Checkout affects payment and order placement. Should I open checkout?',
                actions: [],
                ui: {
                    surface: 'confirmation_card',
                    confirmation: {
                        token: `checkout-${Date.now().toString(36)}`,
                        message: 'Checkout affects payment and order placement. Confirm before continuing.',
                        action: confirmationAction,
                    },
                },
                followUps: buildFollowUps({
                    intent: 'navigation',
                    actionType: 'checkout',
                }),
                sessionMemory: buildSessionMemory({
                    current: sessionMemory,
                    assistantTurn: workingInterpretation,
                    clarificationState: {},
                }),
            });

            return {
                answer: assistantTurn.response,
                assistantTurn,
                products: [],
                followUps: assistantTurn.followUps,
                provider,
            };
        }

        const action = {
            type: 'navigate_to',
            page,
            params,
            reason: 'validated_navigation',
        };
        const assistantTurn = createAssistantTurn({
            intent: 'navigation',
            entities: workingInterpretation.entities,
            confidence: workingInterpretation.confidence,
            decision: 'act',
            response: '',
            actions: [action],
            ui: {
                surface: page === 'cart' ? 'cart_summary' : 'navigation_notice',
                navigation: {
                    page,
                    path: page === 'product' && params.productId ? `/product/${params.productId}` : path,
                    params,
                },
                cartSummary: page === 'cart' ? context?.cartSummary || null : null,
            },
            followUps: buildFollowUps({
                intent: 'navigation',
                categoryLabel,
                inferred,
            }),
            sessionMemory: buildSessionMemory({
                current: sessionMemory,
                assistantTurn: workingInterpretation,
                clarificationState: {},
            }),
        });

        return {
            answer: assistantTurn.response,
            assistantTurn,
            products: [],
            followUps: [],
            provider,
        };
    }

    if (workingInterpretation.intent === 'support') {
        const orderId = safeString(workingInterpretation.meta?.orderId || '');
        const prefill = buildSupportPrefill({
            message,
            orderId,
        });
        const page = safeString(workingInterpretation.meta?.page || (orderId ? 'orders' : 'support'));
        const params = orderId
            ? {
                focus: orderId,
                support: 1,
                category: prefill.category,
                subject: prefill.subject,
                intent: prefill.body,
            }
            : {
                tab: 'support',
                compose: 1,
                category: prefill.category,
                subject: prefill.subject,
                intent: prefill.body,
            };
        const action = {
            type: 'navigate_to',
            page,
            params,
            reason: 'validated_support_handoff',
        };
        const assistantTurn = createAssistantTurn({
            intent: 'support',
            entities: workingInterpretation.entities,
            confidence: workingInterpretation.confidence,
            decision: 'act',
            response: '',
            actions: [action],
            ui: {
                surface: 'support_handoff',
                support: {
                    orderId,
                    prefill,
                },
                navigation: {
                    page,
                    path: page === 'orders' ? '/orders' : '/profile?tab=support',
                    params,
                },
            },
            followUps: buildFollowUps({
                intent: 'support',
                hasMoreContext: Boolean(orderId),
            }),
            sessionMemory: buildSessionMemory({
                current: sessionMemory,
                assistantTurn: workingInterpretation,
                clarificationState: {},
            }),
        });

        return {
            answer: assistantTurn.response,
            assistantTurn,
            products: [],
            followUps: assistantTurn.followUps,
            provider,
        };
    }

    const assistantTurn = createAssistantTurn({
        intent: 'unclear',
        entities: workingInterpretation.entities,
        confidence: workingInterpretation.confidence,
        decision: 'clarify',
        response: 'Can you clarify what you want?',
        ui: {
            surface: 'plain_answer',
        },
        sessionMemory: buildSessionMemory({
            current: sessionMemory,
            assistantTurn: workingInterpretation,
            clarificationState: normalizeClarificationState(sessionMemory?.clarificationState || {}),
        }),
    });

    return {
        answer: assistantTurn.response,
        assistantTurn,
        products: [],
        followUps: [],
        provider,
    };
};

const buildLegacyShape = ({ answer = '', products = [], followUps = [], provider = 'local', mode = 'chat', assistantTurn = {} }) => ({
    text: safeString(answer),
    products: uniqueProducts(products).slice(0, 6),
    suggestions: Array.isArray(followUps) ? followUps.slice(0, 4) : [],
    actionType: safeString(assistantTurn?.intent || 'assistant'),
    isAI: provider !== 'local',
    provider,
    mode,
});

const processRecoveredAssistantTurn = async ({
    user = null,
    message = '',
    conversationHistory = [],
    assistantMode = 'chat',
    context = {},
}) => {
    const sessionMemory = resolveSessionMemory(context);
    const deterministic = buildDeterministicInterpretation({
        message,
        context,
        sessionMemory,
    });

    let interpretation = deterministic;
    let provider = 'local';

    if (shouldUseModel(deterministic)) {
        const model = await interpretWithModel({
            message,
            sessionMemory,
            deterministic,
        });
        interpretation = mergeInterpretations(deterministic, model.interpretation);
        provider = safeString(model.provider || 'local');
    }

    interpretation = {
        ...interpretation,
        meta: deterministic.meta,
        provider: provider === 'local' ? safeString(deterministic.provider || 'local') : provider,
    };

    const executed = await executeDecision({
        message,
        interpretation,
        context,
        sessionMemory,
        conversationHistory,
        user,
        assistantMode,
    });

    return {
        answer: safeString(executed.answer || executed.assistantTurn?.response || ''),
        products: uniqueProducts(executed.products || []).slice(0, 6),
        actions: Array.isArray(executed.assistantTurn?.actions) ? executed.assistantTurn.actions : [],
        followUps: Array.isArray(executed.followUps) ? executed.followUps : [],
        assistantTurn: executed.assistantTurn,
        provider: safeString(executed.provider || interpretation.provider || 'local'),
        grounding: {
            mode: safeString(assistantMode || 'chat'),
            actionType: safeString(executed.assistantTurn?.intent || interpretation.intent || 'assistant'),
            sessionMemory: executed.assistantTurn?.sessionMemory || sessionMemory,
        },
        sessionMemory: executed.assistantTurn?.sessionMemory || sessionMemory,
        legacy: buildLegacyShape({
            answer: safeString(executed.answer || executed.assistantTurn?.response || ''),
            products: executed.products || [],
            followUps: executed.followUps || [],
            provider: safeString(executed.provider || interpretation.provider || 'local'),
            mode: safeString(assistantMode || 'chat'),
            assistantTurn: executed.assistantTurn,
        }),
    };
};

module.exports = {
    buildDeterministicInterpretation,
    processRecoveredAssistantTurn,
    resolveSessionMemory,
};

const { generateStructuredResponse } = require('./providerRegistry');
const { getProductByIdentifier } = require('../catalogService');
const { cleanSearchQuery, extractBudget, searchProducts } = require('./assistantSearchService');

const CONFIDENCE_THRESHOLD = 0.62;

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

const safeString = (value, fallback = '') => String(value === undefined || value === null ? fallback : value).trim();
const safeLower = (value, fallback = '') => safeString(value, fallback).toLowerCase();
const clamp = (value, min, max) => Math.min(Math.max(Number(value) || 0, min), max);

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
        currentIntent: safeString(rawMemory.currentIntent || context.currentIntent || ''),
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
    const showMore = SHOW_MORE_PATTERN.test(safeMessage) && Boolean(lastQuery);
    const searchQuery = cleanSearchQuery(
        showMore ? lastQuery : safeMessage,
        context?.category || ''
    );

    if (CART_ADD_PATTERN.test(safeMessage)) {
        return {
            intent: 'cart_action',
            entities: {
                query: lastQuery,
                productId: productReference.productId,
                quantity,
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
            },
            confidence: orderId ? 0.95 : 0.86,
            decision: 'act',
            response: '',
            meta: {
                operation: '',
                page: orderId || /\b(track|tracking)\b/i.test(safeMessage) ? 'orders' : 'support',
                orderId,
                showMore: false,
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
            },
            confidence: 0.91,
            decision: 'act',
            response: '',
            meta: {
                operation: '',
                page: pageTarget.page,
                orderId,
                showMore: false,
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
            },
            confidence: 0.93,
            decision: 'clarify',
            response: 'Checkout affects payment and order placement. Should I open checkout?',
            meta: {
                operation: '',
                page: 'checkout',
                orderId: '',
                showMore: false,
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
            },
            confidence: 0.89,
            decision: 'act',
            response: '',
            meta: {
                operation: '',
                page: 'product',
                orderId: '',
                showMore: false,
            },
        };
    }

    if (showMore || SEARCH_PATTERN.test(safeMessage) || extractBudget(safeMessage) > 0 || /\biphone|samsung|pixel|laptop|headphone|earbuds|watch|tv|book|shoes?\b/i.test(normalized)) {
        return {
            intent: 'product_search',
            entities: {
                query: searchQuery || lastQuery || safeMessage,
                productId: '',
                quantity: 0,
            },
            confidence: showMore ? 0.9 : 0.84,
            decision: searchQuery || lastQuery ? 'act' : 'clarify',
            response: searchQuery || lastQuery ? '' : 'What product should I search for?',
            meta: {
                operation: '',
                page: '',
                orderId: '',
                showMore,
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
            },
            confidence: 0.76,
            decision: 'respond',
            response: '',
            meta: {
                operation: '',
                page: '',
                orderId: '',
                showMore: false,
            },
        };
    }

    return {
        intent: 'unclear',
        entities: {
            query: safeMessage,
            productId: '',
            quantity: 0,
        },
        confidence: 0.32,
        decision: 'clarify',
        response: 'Do you want a product search, a cart action, navigation help, or a general answer?',
        meta: {
            operation: '',
            page: '',
            orderId: '',
            showMore: false,
        },
    };
};

const buildInterpreterSystemPrompt = () => [
    'You classify turns for a production ecommerce assistant.',
    'Return strict JSON only.',
    'Use this exact schema and no extra fields:',
    '{"intent":"product_search | general_knowledge | cart_action | navigation | support | unclear","entities":{"query":"","productId":"","quantity":0},"confidence":0.0,"decision":"respond | act | clarify","response":""}',
    'Rules:',
    '- product_search is only for shopping discovery, recommendations, comparisons, budgets, or more results.',
    '- general_knowledge is only for non-commerce factual or explanatory questions.',
    '- cart_action is only for adding or removing a product from cart.',
    '- navigation is for opening app pages like cart, checkout, orders, profile, wishlist, marketplace, or a product detail page.',
    '- support is for refunds, returns, replacements, tracking, account help, payment issues, or complaints.',
    '- unclear is for ambiguous requests with insufficient evidence.',
    '- Never invent productId. Only populate it when the user explicitly names it or the provided session memory makes the reference unambiguous.',
    '- quantity must be an integer. Use 0 when absent except for cart actions, where 1 is the safe default.',
    '- If the request is ambiguous, use decision="clarify" and ask one short question in response.',
    '- For product_search, cart_action, navigation, and support, response should describe the next validated step without claiming it already happened.',
    '- For general_knowledge, answer the question directly and do not mention shopping UI.',
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
        currentIntent: safeString(sessionMemory?.currentIntent || ''),
    };

    return [
        `User message: ${safeString(message)}`,
        `Session memory: ${JSON.stringify(summary)}`,
        `Deterministic hint: ${JSON.stringify({
            intent: deterministic.intent,
            entities: deterministic.entities,
            confidence: deterministic.confidence,
            decision: deterministic.decision,
        })}`,
        'Return JSON only.',
    ].join('\n\n');
};

const normalizeModelInterpretation = (payload = {}, fallback = {}) => ({
    intent: ['product_search', 'general_knowledge', 'cart_action', 'navigation', 'support', 'unclear'].includes(safeString(payload?.intent))
        ? safeString(payload.intent)
        : safeString(fallback.intent || 'unclear'),
    entities: {
        query: safeString(payload?.entities?.query || fallback?.entities?.query || ''),
        productId: safeString(payload?.entities?.productId || fallback?.entities?.productId || ''),
        quantity: Math.max(0, Number(payload?.entities?.quantity ?? fallback?.entities?.quantity ?? 0) || 0),
    },
    confidence: clamp(payload?.confidence ?? fallback?.confidence ?? 0, 0, 1),
    decision: ['respond', 'act', 'clarify'].includes(safeString(payload?.decision))
        ? safeString(payload.decision)
        : safeString(fallback.decision || 'clarify'),
    response: safeString(payload?.response || fallback?.response || ''),
});

const shouldUseModel = (deterministic = {}) => (
    deterministic.intent === 'general_knowledge'
    || deterministic.intent === 'unclear'
    || Number(deterministic.confidence || 0) < 0.84
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

    if (deterministicConfidence >= 0.9 && deterministic.intent !== 'general_knowledge') {
        return deterministic;
    }

    if (!model.intent || model.intent === 'unclear') {
        return deterministicConfidence >= modelConfidence ? deterministic : model;
    }

    if (deterministic.intent === model.intent) {
        return {
            ...model,
            entities: {
                query: safeString(model.entities?.query || deterministic.entities?.query || ''),
                productId: safeString(model.entities?.productId || deterministic.entities?.productId || ''),
                quantity: Math.max(0, Number(model.entities?.quantity || deterministic.entities?.quantity || 0)),
            },
            confidence: Math.max(modelConfidence, deterministicConfidence),
            response: safeString(model.response || deterministic.response || ''),
        };
    }

    if (modelConfidence >= deterministicConfidence + 0.14) {
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

const buildSessionMemory = ({
    current = {},
    assistantTurn = {},
    products = [],
    activeProduct = null,
}) => ({
    lastQuery: safeString(
        assistantTurn?.intent === 'product_search'
            ? assistantTurn?.entities?.query
            : current?.lastQuery || ''
    ),
    lastResults: assistantTurn?.intent === 'product_search'
        ? uniqueProducts(products).slice(0, 6)
        : uniqueProducts(current?.lastResults || []).slice(0, 6),
    activeProduct: normalizeProductSummary(activeProduct || current?.activeProduct || null),
    currentIntent: safeString(assistantTurn?.intent || current?.currentIntent || ''),
});

const buildFollowUps = ({ intent = '', products = [], actionType = '', hasMoreContext = false }) => {
    if (intent === 'product_search') {
        const next = [];
        if (products.length > 1) next.push('show more');
        if (products.length === 1) next.push('add this to cart');
        return next.slice(0, 3);
    }

    if (intent === 'cart_action') {
        return ['show my cart', 'go to checkout'].slice(0, 2);
    }

    if (intent === 'support') {
        return hasMoreContext ? ['open support'] : ['show my orders'];
    }

    if (intent === 'navigation' && actionType === 'checkout') {
        return ['show my cart'];
    }

    return [];
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

const executeDecision = async ({
    message = '',
    interpretation = {},
    context = {},
    sessionMemory = {},
}) => {
    const meta = interpretation.meta || {};
    const provider = safeString(interpretation.provider || 'local');
    const lowConfidence = Number(interpretation.confidence || 0) < CONFIDENCE_THRESHOLD;

    if (lowConfidence || interpretation.intent === 'unclear') {
        const assistantTurn = createAssistantTurn({
            intent: 'unclear',
            entities: interpretation.entities,
            confidence: interpretation.confidence,
            decision: 'clarify',
            response: interpretation.response || 'Can you tell me whether you want a product search, a cart action, navigation help, or a general answer?',
            ui: {
                surface: 'plain_answer',
            },
            followUps: [],
            sessionMemory: buildSessionMemory({
                current: sessionMemory,
                assistantTurn: interpretation,
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

    if (interpretation.intent === 'general_knowledge') {
        const knowledge = await answerGeneralKnowledge(message);
        const assistantTurn = createAssistantTurn({
            intent: 'general_knowledge',
            entities: interpretation.entities,
            confidence: interpretation.confidence,
            decision: 'respond',
            response: knowledge.response || interpretation.response,
            ui: {
                surface: 'plain_answer',
            },
            followUps: [],
            sessionMemory: buildSessionMemory({
                current: sessionMemory,
                assistantTurn: interpretation,
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

    if (interpretation.intent === 'product_search') {
        const excludeIds = meta.showMore
            ? (sessionMemory?.lastResults || []).map((product) => safeString(product?.id)).filter(Boolean)
            : [];
        const search = await searchProducts({
            query: interpretation.entities?.query,
            category: context?.category || '',
            maxPrice: extractBudget(message),
            excludeIds,
            limit: 6,
        });

        const products = uniqueProducts(search.products).slice(0, 6);
        const assistantTurn = createAssistantTurn({
            intent: 'product_search',
            entities: {
                ...interpretation.entities,
                query: safeString(search.query || interpretation.entities?.query || ''),
            },
            confidence: interpretation.confidence,
            decision: products.length > 0 ? 'respond' : 'clarify',
            response: products.length > 0
                ? `Found ${products.length} relevant result${products.length === 1 ? '' : 's'} for ${safeString(search.query || interpretation.entities?.query || 'your search')}.`
                : `I couldn't find relevant products for ${safeString(search.query || interpretation.entities?.query || 'that search')}. Try a more specific product name or category.`,
            ui: {
                surface: products.length > 1 ? 'product_results' : products.length === 1 ? 'product_focus' : 'plain_answer',
                products,
                product: products.length === 1 ? products[0] : null,
            },
            followUps: buildFollowUps({
                intent: 'product_search',
                products,
            }),
            sessionMemory: buildSessionMemory({
                current: sessionMemory,
                assistantTurn: {
                    ...interpretation,
                    entities: {
                        ...interpretation.entities,
                        query: safeString(search.query || interpretation.entities?.query || ''),
                    },
                },
                products,
                activeProduct: products.length === 1 ? products[0] : null,
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

    if (interpretation.intent === 'cart_action') {
        const productId = safeString(interpretation.entities?.productId || '');
        const operation = safeString(meta.operation || 'add');
        if (!productId) {
            const assistantTurn = createAssistantTurn({
                intent: 'cart_action',
                entities: interpretation.entities,
                confidence: interpretation.confidence,
                decision: 'clarify',
                response: operation === 'remove'
                    ? 'Which cart item should I remove?'
                    : 'Which product should I add to your cart?',
                ui: {
                    surface: 'plain_answer',
                },
                sessionMemory: buildSessionMemory({
                    current: sessionMemory,
                    assistantTurn: interpretation,
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

        const product = await getProductByIdentifier(productId).catch(() => null);
        const action = {
            type: operation === 'remove' ? 'remove_from_cart' : 'add_to_cart',
            productId,
            quantity: Math.max(1, Number(interpretation.entities?.quantity || 1)),
            reason: 'validated_cart_action',
        };
        const assistantTurn = createAssistantTurn({
            intent: 'cart_action',
            entities: {
                ...interpretation.entities,
                productId,
                quantity: Math.max(1, Number(interpretation.entities?.quantity || 1)),
            },
            confidence: interpretation.confidence,
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
                assistantTurn: interpretation,
                activeProduct: product || sessionMemory.activeProduct,
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

    if (interpretation.intent === 'navigation') {
        const page = safeString(meta.page || '');
        const path = PAGE_TARGETS.find((entry) => entry.page === page)?.path || '/';
        const params = {};

        if (page === 'product') {
            const productId = safeString(interpretation.entities?.productId || '');
            if (!productId) {
                const assistantTurn = createAssistantTurn({
                    intent: 'navigation',
                    entities: interpretation.entities,
                    confidence: interpretation.confidence,
                    decision: 'clarify',
                    response: 'Which product should I open?',
                    ui: {
                        surface: 'plain_answer',
                    },
                    sessionMemory: buildSessionMemory({
                        current: sessionMemory,
                        assistantTurn: interpretation,
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

            params.productId = productId;
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
                entities: interpretation.entities,
                confidence: interpretation.confidence,
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
                    assistantTurn: interpretation,
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
            entities: interpretation.entities,
            confidence: interpretation.confidence,
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
            followUps: [],
            sessionMemory: buildSessionMemory({
                current: sessionMemory,
                assistantTurn: interpretation,
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

    if (interpretation.intent === 'support') {
        const orderId = safeString(meta.orderId || '');
        const prefill = buildSupportPrefill({
            message,
            orderId,
        });
        const page = safeString(meta.page || (orderId ? 'orders' : 'support'));
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
            entities: interpretation.entities,
            confidence: interpretation.confidence,
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
                assistantTurn: interpretation,
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
        entities: interpretation.entities,
        confidence: interpretation.confidence,
        decision: 'clarify',
        response: 'Can you tell me what you want me to do?',
        ui: {
            surface: 'plain_answer',
        },
        sessionMemory: buildSessionMemory({
            current: sessionMemory,
            assistantTurn: interpretation,
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

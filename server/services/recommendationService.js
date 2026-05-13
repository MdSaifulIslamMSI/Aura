const RecommendationEvent = require('../models/RecommendationEvent');
const logger = require('../utils/logger');
const {
    RECOMMENDATION_REASONS,
    SOURCE_LABELS,
    clampRecommendationLimit,
} = require('../utils/recommendationConstants');
const {
    getCartAddOnCandidates,
    getFallbackProductCandidates,
    getFrequentlyBoughtTogetherCandidates,
    getPersonalizedCandidates,
    getRecentlyViewedBasedCandidates,
    getSearchBasedCandidates,
    getSimilarProductCandidates,
    getTrendingProductCandidates,
    productDisplayId,
    resolveProductByIdentifier,
} = require('./candidateService');
const { recordRecommendationEvent } = require('./recommendationEventService');
const { applyBusinessReranking } = require('./rerankingService');
const { mergeAndScoreCandidates } = require('./scoringService');
const { buildUserPreferenceProfile } = require('./userPreferenceService');

const safeString = (value = '') => String(value === undefined || value === null ? '' : value).trim();
const safeLower = (value = '') => safeString(value).toLowerCase();

const CATEGORY_HINTS = [
    { category: 'Mobiles', terms: ['phone', 'phones', 'mobile', 'mobiles', 'smartphone', 'smartphones'] },
    { category: 'Laptops', terms: ['laptop', 'laptops', 'notebook', 'notebooks'] },
    { category: 'Electronics', terms: ['electronics', 'earbuds', 'headphone', 'headphones', 'charger', 'camera'] },
    { category: 'Footwear', terms: ['shoe', 'shoes', 'sneaker', 'sneakers', 'footwear', 'socks'] },
    { category: 'Fashion', terms: ['shirt', 'shirts', 'dress', 'dresses', 'jeans', 'tshirt', 't-shirt', 'clothes', 'fashion'] },
    { category: 'Gaming', terms: ['gaming', 'controller', 'console', 'headset'] },
    { category: 'Books', terms: ['book', 'books', 'novel', 'novels'] },
    { category: 'Home & Kitchen', terms: ['home', 'kitchen', 'furniture', 'appliance'] },
];

const buildIdentity = ({ userId = null, sessionId = '' } = {}) => ({
    userId: userId || null,
    sessionId: safeString(sessionId || (userId ? `user-${userId}` : '')),
});

const buildCartIdSet = (profile = {}, cartItems = []) => {
    const ids = new Set();
    (profile.cartProductIds || []).forEach((id) => ids.add(safeString(id)));
    (Array.isArray(cartItems) ? cartItems : []).forEach((item) => {
        [item?.productId, item?.id, item?._id].map(safeString).filter(Boolean).forEach((id) => ids.add(id));
    });
    return ids;
};

const buildPurchasedIdSet = (profile = {}) => new Set((profile.purchasedProductIds || []).map(safeString).filter(Boolean));

const getRecommendationIntent = (message = '') => {
    const normalized = safeLower(message);
    const budgetMatch = normalized.match(/\b(?:under|below|less than|within|upto|up to)\s*(?:rs\.?|inr|₹)?\s*([0-9][0-9,]*)\b/i)
        || normalized.match(/\b(?:rs\.?|inr|₹)\s*([0-9][0-9,]*)\b/i);
    const maxPrice = budgetMatch ? Number(String(budgetMatch[1] || '').replace(/,/g, '')) || 0 : 0;
    const categoryHint = CATEGORY_HINTS.find((entry) => entry.terms.some((term) => new RegExp(`\\b${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(normalized)));
    const wantsAddOns = /\b(with|accessor(?:y|ies)|addon|add-on|complete|bundle|together|cart)\b/i.test(normalized);
    const wantsSimilar = /\b(similar|like this|related|alternative|alternatives)\b/i.test(normalized);
    const wantsPersonal = /\b(for me|my|personal|recommend|suggest)\b/i.test(normalized);

    return {
        category: safeString(categoryHint?.category || ''),
        maxPrice,
        wantsAddOns,
        wantsSimilar,
        wantsPersonal,
    };
};

const matchesIntent = (recommendation = {}, intent = {}) => {
    const product = recommendation.product || {};
    const maxPrice = Number(intent.maxPrice || 0);
    if (maxPrice > 0 && Number(product.price || 0) > maxPrice) return false;
    if (intent.category) {
        const requested = safeLower(intent.category).replace(/&/g, 'and');
        const category = safeLower(product.category).replace(/&/g, 'and');
        const subCategory = safeLower(product.subCategory).replace(/&/g, 'and');
        const tags = (Array.isArray(product.tags) ? product.tags : []).map(safeLower);
        if (!category.includes(requested) && !requested.includes(category) && !subCategory.includes(requested) && !tags.some((tag) => tag.includes(requested))) {
            return false;
        }
    }
    return true;
};

const filterByAssistantIntent = (recommendations = [], intent = {}, limit = 5) => {
    const filtered = recommendations.filter((item) => matchesIntent(item, intent));
    return (filtered.length > 0 ? filtered : recommendations).slice(0, limit);
};

const formatRecommendations = (recommendations = [], { debug = false } = {}) => (
    recommendations.map((item) => ({
        product: item.product,
        score: item.score,
        reason: item.reason,
        source: item.source,
        ...(debug && item.debug ? { debug: item.debug } : {}),
    }))
);

const runPipeline = async ({
    candidateGroups = [],
    profile = null,
    userId = null,
    sessionId = '',
    cartItems = [],
    currentProductId = '',
    excludeIds = new Set(),
    limit = 8,
    debug = false,
    maxPerBrand = 2,
    maxPerCategory = 4,
} = {}) => {
    const safeLimit = clampRecommendationLimit(limit, 8, 24);
    const resolvedProfile = profile || await buildUserPreferenceProfile({ userId, sessionId });
    const cartIds = buildCartIdSet(resolvedProfile, cartItems);
    const purchasedIds = buildPurchasedIdSet(resolvedProfile);
    const mergedExcludeIds = new Set([
        ...(resolvedProfile.excludeIds || []),
        ...(excludeIds || []),
        ...cartIds,
    ].map(safeString).filter(Boolean));

    const scored = mergeAndScoreCandidates(candidateGroups, {
        profile: resolvedProfile,
        cartIds,
        purchasedIds,
        currentProductId: safeString(currentProductId),
    });
    const ranked = applyBusinessReranking(scored, {
        limit: safeLimit,
        excludeIds: mergedExcludeIds,
        currentProductId: safeString(currentProductId),
        maxPerBrand,
        maxPerCategory,
    });

    return formatRecommendations(ranked, { debug });
};

const withFallback = async (operationName, work, { limit = 8, debug = false } = {}) => {
    try {
        const recommendations = await work();
        if (recommendations.length > 0) return recommendations;

        const fallbackCandidates = await getFallbackProductCandidates({
            limit,
            reason: RECOMMENDATION_REASONS.coldStart,
        });
        return runPipeline({
            candidateGroups: [fallbackCandidates],
            limit,
            debug,
            maxPerCategory: 3,
        });
    } catch (error) {
        logger.warn('recommendations.fallback', { operationName, error: error.message });
        try {
            const fallbackCandidates = await getFallbackProductCandidates({
                limit,
                reason: RECOMMENDATION_REASONS.topRated,
            });
            return runPipeline({
                candidateGroups: [fallbackCandidates],
                limit,
                debug,
                maxPerCategory: 3,
            });
        } catch (fallbackError) {
            logger.error('recommendations.fallback_failed', { operationName, error: fallbackError.message });
            return [];
        }
    }
};

const getHomeRecommendations = async ({ userId = null, sessionId = '', limit = 12, debug = false } = {}) => {
    const identity = buildIdentity({ userId, sessionId });
    const safeLimit = clampRecommendationLimit(limit, 12, 24);
    return withFallback('home', async () => {
        const profile = await buildUserPreferenceProfile(identity);
        const [personalized, recent, trending, fallback] = await Promise.all([
            profile.hasSignals ? getPersonalizedCandidates({ profile, limit: safeLimit * 2 }) : Promise.resolve([]),
            profile.hasSignals ? getRecentlyViewedBasedCandidates({ ...identity, limit: safeLimit }) : Promise.resolve([]),
            getTrendingProductCandidates({ limit: safeLimit * 2 }),
            getFallbackProductCandidates({ limit: safeLimit, reason: profile.hasSignals ? RECOMMENDATION_REASONS.recentInterest : RECOMMENDATION_REASONS.coldStart }),
        ]);

        return runPipeline({
            candidateGroups: [personalized, recent, trending, fallback],
            profile,
            ...identity,
            limit: safeLimit,
            debug,
            maxPerBrand: 2,
            maxPerCategory: 3,
        });
    }, { limit: safeLimit, debug });
};

const getSimilarProducts = async ({ productId = '', userId = null, sessionId = '', limit = 8, debug = false } = {}) => {
    const identity = buildIdentity({ userId, sessionId });
    const safeLimit = clampRecommendationLimit(limit, 8, 24);
    return withFallback('similar', async () => {
        const [similar, trending] = await Promise.all([
            getSimilarProductCandidates({ productId, limit: safeLimit * 3 }),
            getTrendingProductCandidates({ limit: safeLimit }),
        ]);
        return runPipeline({
            candidateGroups: [similar, trending],
            ...identity,
            currentProductId: productId,
            excludeIds: new Set([safeString(productId)]),
            limit: safeLimit,
            debug,
            maxPerBrand: 3,
            maxPerCategory: safeLimit,
        });
    }, { limit: safeLimit, debug });
};

const getCartRecommendations = async ({ userId = null, sessionId = '', cartItems = [], limit = 8, debug = false } = {}) => {
    const identity = buildIdentity({ userId, sessionId });
    const safeLimit = clampRecommendationLimit(limit, 8, 24);
    return withFallback('cart', async () => {
        const profile = await buildUserPreferenceProfile(identity);
        const [cartAddOns, personalized, trending] = await Promise.all([
            getCartAddOnCandidates({ cartItems, limit: safeLimit * 3 }),
            getPersonalizedCandidates({ profile, limit: safeLimit }),
            getTrendingProductCandidates({ limit: safeLimit }),
        ]);

        return runPipeline({
            candidateGroups: [cartAddOns, personalized, trending],
            profile,
            ...identity,
            cartItems,
            limit: safeLimit,
            debug,
            maxPerBrand: 3,
            maxPerCategory: 4,
        });
    }, { limit: safeLimit, debug });
};

const getTrendingProducts = async ({ limit = 12, debug = false } = {}) => {
    const safeLimit = clampRecommendationLimit(limit, 12, 24);
    return withFallback('trending', async () => {
        const trending = await getTrendingProductCandidates({ limit: safeLimit * 2 });
        return runPipeline({
            candidateGroups: [trending],
            limit: safeLimit,
            debug,
            maxPerBrand: 3,
            maxPerCategory: 4,
        });
    }, { limit: safeLimit, debug });
};

const getRecentlyViewedRecommendations = async ({ userId = null, sessionId = '', limit = 8, debug = false } = {}) => {
    const identity = buildIdentity({ userId, sessionId });
    const safeLimit = clampRecommendationLimit(limit, 8, 24);
    return withFallback('recently_viewed', async () => {
        const [recent, trending] = await Promise.all([
            getRecentlyViewedBasedCandidates({ ...identity, limit: safeLimit * 2 }),
            getTrendingProductCandidates({ limit: safeLimit }),
        ]);
        return runPipeline({
            candidateGroups: [recent, trending],
            ...identity,
            limit: safeLimit,
            debug,
            maxPerBrand: 3,
            maxPerCategory: 4,
        });
    }, { limit: safeLimit, debug });
};

const getFrequentlyBoughtTogether = async ({ productIds = [], cartItems = [], limit = 8, debug = false } = {}) => {
    const safeLimit = clampRecommendationLimit(limit, 8, 24);
    return withFallback('frequently_bought_together', async () => {
        const boughtTogether = await getFrequentlyBoughtTogetherCandidates({
            productIds,
            cartItems,
            limit: safeLimit * 3,
        });
        return runPipeline({
            candidateGroups: [boughtTogether],
            cartItems,
            excludeIds: new Set([...(Array.isArray(productIds) ? productIds : [productIds])].map(safeString).filter(Boolean)),
            limit: safeLimit,
            debug,
            maxPerBrand: 3,
            maxPerCategory: 5,
        });
    }, { limit: safeLimit, debug });
};

const getSearchRecommendations = async ({ query = '', userId = null, sessionId = '', limit = 8, debug = false } = {}) => {
    const identity = buildIdentity({ userId, sessionId });
    const safeLimit = clampRecommendationLimit(limit, 8, 24);
    return withFallback('search', async () => {
        const profile = await buildUserPreferenceProfile(identity);
        const [searchCandidates, personalized, trending] = await Promise.all([
            getSearchBasedCandidates({ query, limit: safeLimit * 2 }),
            getPersonalizedCandidates({ profile, limit: safeLimit }),
            getTrendingProductCandidates({ limit: safeLimit }),
        ]);
        return runPipeline({
            candidateGroups: [searchCandidates, personalized, trending],
            profile,
            ...identity,
            limit: safeLimit,
            debug,
            maxPerBrand: 3,
            maxPerCategory: 4,
        });
    }, { limit: safeLimit, debug });
};

const getAssistantRecommendations = async ({
    userId = null,
    sessionId = '',
    message = '',
    context = {},
    limit = 5,
    debug = false,
} = {}) => {
    const identity = buildIdentity({ userId, sessionId });
    const safeLimit = clampRecommendationLimit(limit, 5, 12);
    const intent = getRecommendationIntent(message);
    const currentProductId = safeString(context?.currentProductId || context?.productId || '');
    const cartItems = Array.isArray(context?.cartItems) ? context.cartItems : [];

    await recordRecommendationEvent({
        ...identity,
        eventType: 'assistant_recommendation_request',
        productId: currentProductId,
        searchQuery: message,
        sourcePage: 'assistant',
        metadata: { intent, contextPage: safeString(context?.page || '') },
    }).catch((error) => {
        logger.warn('recommendations.assistant_event_failed', { error: error.message });
    });

    return withFallback('assistant', async () => {
        const profile = await buildUserPreferenceProfile(identity);
        const groups = await Promise.all([
            currentProductId ? getSimilarProductCandidates({ productId: currentProductId, limit: safeLimit * 2 }) : Promise.resolve([]),
            (cartItems.length > 0 || intent.wantsAddOns) ? getCartAddOnCandidates({ cartItems, limit: safeLimit * 2 }) : Promise.resolve([]),
            safeString(message) ? getSearchBasedCandidates({ query: message, limit: safeLimit * 2 }) : Promise.resolve([]),
            getPersonalizedCandidates({ profile, limit: safeLimit * 2 }),
            getTrendingProductCandidates({ limit: safeLimit }),
        ]);

        let recommendations = await runPipeline({
            candidateGroups: groups,
            profile,
            ...identity,
            cartItems,
            currentProductId,
            excludeIds: new Set([currentProductId].filter(Boolean)),
            limit: safeLimit * 2,
            debug,
            maxPerBrand: 3,
            maxPerCategory: 4,
        });

        recommendations = filterByAssistantIntent(recommendations, intent, safeLimit).map((item) => ({
            ...item,
            source: item.source === SOURCE_LABELS.fallback ? SOURCE_LABELS.assistant : item.source,
            reason: item.reason || RECOMMENDATION_REASONS.recentInterest,
        }));

        if (recommendations.length === 0 && currentProductId) {
            const product = await resolveProductByIdentifier(currentProductId);
            if (product) {
                const fallback = await getSimilarProductCandidates({ productId: productDisplayId(product), limit: safeLimit * 2 });
                recommendations = await runPipeline({
                    candidateGroups: [fallback],
                    ...identity,
                    currentProductId,
                    limit: safeLimit,
                    debug,
                });
            }
        }

        return recommendations.slice(0, safeLimit);
    }, { limit: safeLimit, debug });
};

const getRecommendationsForAssistant = getAssistantRecommendations;

const getRecommendationDebugInfo = async ({ userId = null, sessionId = '' } = {}) => {
    const identity = buildIdentity({ userId, sessionId });
    const [profile, totalEvents, topViewed, topCart, topPurchased, recentClicks, trending] = await Promise.all([
        buildUserPreferenceProfile(identity),
        RecommendationEvent.countDocuments(identity.userId ? { userId: identity.userId } : { sessionId: identity.sessionId }),
        RecommendationEvent.aggregate([
            { $match: { ...(identity.userId ? { userId: identity.userId } : { sessionId: identity.sessionId }), eventType: 'product_view' } },
            { $group: { _id: { productId: '$productId', productNumericId: '$productNumericId' }, count: { $sum: 1 } } },
            { $sort: { count: -1 } },
            { $limit: 10 },
        ]),
        RecommendationEvent.aggregate([
            { $match: { ...(identity.userId ? { userId: identity.userId } : { sessionId: identity.sessionId }), eventType: 'add_to_cart' } },
            { $group: { _id: { productId: '$productId', productNumericId: '$productNumericId' }, count: { $sum: 1 } } },
            { $sort: { count: -1 } },
            { $limit: 10 },
        ]),
        RecommendationEvent.aggregate([
            { $match: { ...(identity.userId ? { userId: identity.userId } : { sessionId: identity.sessionId }), eventType: 'purchase' } },
            { $group: { _id: { productId: '$productId', productNumericId: '$productNumericId' }, count: { $sum: 1 } } },
            { $sort: { count: -1 } },
            { $limit: 10 },
        ]),
        RecommendationEvent.find({ ...(identity.userId ? { userId: identity.userId } : { sessionId: identity.sessionId }), eventType: 'recommendation_click' })
            .sort({ createdAt: -1 })
            .limit(10)
            .lean(),
        getTrendingProducts({ limit: 8, debug: true }),
    ]);

    return {
        profile,
        totalEvents,
        topViewed,
        topCart,
        topPurchased,
        recentClicks,
        trending,
    };
};

module.exports = {
    getAssistantRecommendations,
    getCartRecommendations,
    getFrequentlyBoughtTogether,
    getHomeRecommendations,
    getRecommendationDebugInfo,
    getRecommendationsForAssistant,
    getRecentlyViewedRecommendations,
    getSearchRecommendations,
    getSimilarProducts,
    getTrendingProducts,
};

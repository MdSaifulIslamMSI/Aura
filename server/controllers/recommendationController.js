const asyncHandler = require('express-async-handler');
const {
    clampRecommendationLimit,
} = require('../utils/recommendationConstants');
const {
    getAssistantRecommendations,
    getCartRecommendations,
    getFrequentlyBoughtTogether,
    getHomeRecommendations,
    getRecommendationDebugInfo,
    getRecentlyViewedRecommendations,
    getSearchRecommendations,
    getSimilarProducts,
    getTrendingProducts,
} = require('../services/recommendationService');

const parseDebug = (value = '') => ['1', 'true', 'yes', 'on'].includes(String(value || '').trim().toLowerCase());

const getSessionId = (req = {}) => (
    req.query?.sessionId
    || req.body?.sessionId
    || req.get?.('x-recommendation-session-id')
    || req.get?.('x-session-id')
    || ''
);

const sendRecommendationResponse = (res, { type = '', recommendations = [], debugPayload = null } = {}) => res.json({
    success: true,
    type,
    count: recommendations.length,
    recommendations,
    ...(debugPayload ? { debug: debugPayload } : {}),
});

const getHome = asyncHandler(async (req, res) => {
    const limit = clampRecommendationLimit(req.query?.limit, 12, 24);
    const debug = parseDebug(req.query?.debug);
    const recommendations = await getHomeRecommendations({
        userId: req.user?._id || null,
        sessionId: getSessionId(req),
        limit,
        debug,
    });
    return sendRecommendationResponse(res, { type: 'recommended_for_you', recommendations });
});

const getSimilar = asyncHandler(async (req, res) => {
    const limit = clampRecommendationLimit(req.query?.limit, 8, 24);
    const debug = parseDebug(req.query?.debug);
    const recommendations = await getSimilarProducts({
        productId: req.params.productId,
        userId: req.user?._id || null,
        sessionId: getSessionId(req),
        limit,
        debug,
    });
    return sendRecommendationResponse(res, { type: 'similar_products', recommendations });
});

const getCart = asyncHandler(async (req, res) => {
    const limit = clampRecommendationLimit(req.body?.limit, 8, 24);
    const debug = parseDebug(req.query?.debug || req.body?.debug);
    const recommendations = await getCartRecommendations({
        userId: req.user?._id || null,
        sessionId: getSessionId(req),
        cartItems: req.body?.cartItems || [],
        limit,
        debug,
    });
    return sendRecommendationResponse(res, { type: 'cart_add_ons', recommendations });
});

const getTrending = asyncHandler(async (req, res) => {
    const limit = clampRecommendationLimit(req.query?.limit, 12, 24);
    const debug = parseDebug(req.query?.debug);
    const recommendations = await getTrendingProducts({ limit, debug });
    return sendRecommendationResponse(res, { type: 'trending_products', recommendations });
});

const getRecentlyViewed = asyncHandler(async (req, res) => {
    const limit = clampRecommendationLimit(req.query?.limit, 8, 24);
    const debug = parseDebug(req.query?.debug);
    const recommendations = await getRecentlyViewedRecommendations({
        userId: req.user?._id || null,
        sessionId: getSessionId(req),
        limit,
        debug,
    });
    return sendRecommendationResponse(res, { type: 'recently_viewed_recommendations', recommendations });
});

const getSearch = asyncHandler(async (req, res) => {
    const limit = clampRecommendationLimit(req.query?.limit, 8, 24);
    const debug = parseDebug(req.query?.debug);
    const recommendations = await getSearchRecommendations({
        query: req.query?.query || req.query?.q || '',
        userId: req.user?._id || null,
        sessionId: getSessionId(req),
        limit,
        debug,
    });
    return sendRecommendationResponse(res, { type: 'search_recommendations', recommendations });
});

const getFrequentlyBought = asyncHandler(async (req, res) => {
    const limit = clampRecommendationLimit(req.query?.limit || req.body?.limit, 8, 24);
    const debug = parseDebug(req.query?.debug || req.body?.debug);
    const productIds = req.params?.productId
        ? [req.params.productId]
        : (req.body?.productIds || req.body?.productId || []);
    const recommendations = await getFrequentlyBoughtTogether({
        productIds,
        cartItems: req.body?.cartItems || [],
        limit,
        debug,
    });
    return sendRecommendationResponse(res, { type: 'frequently_bought_together', recommendations });
});

const getAssistant = asyncHandler(async (req, res) => {
    const limit = clampRecommendationLimit(req.body?.limit, 5, 12);
    const debug = parseDebug(req.query?.debug || req.body?.debug);
    const recommendations = await getAssistantRecommendations({
        userId: req.user?._id || null,
        sessionId: getSessionId(req),
        message: req.body?.message || '',
        context: req.body?.context || {},
        limit,
        debug,
    });
    return sendRecommendationResponse(res, { type: 'assistant_recommendation', recommendations });
});

const getDebug = asyncHandler(async (req, res) => {
    const debug = await getRecommendationDebugInfo({
        userId: req.user?._id || null,
        sessionId: getSessionId(req),
    });
    return res.json({
        success: true,
        debug,
    });
});

module.exports = {
    getAssistant,
    getCart,
    getDebug,
    getFrequentlyBought,
    getHome,
    getRecentlyViewed,
    getSearch,
    getSimilar,
    getTrending,
};

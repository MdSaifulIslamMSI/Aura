const mongoose = require('mongoose');
const RecommendationEvent = require('../models/RecommendationEvent');
const {
    RECOMMENDATION_EVENT_TYPES,
} = require('../utils/recommendationConstants');
const {
    resolveProductByIdentifier,
} = require('./candidateService');

const safeString = (value = '') => String(value === undefined || value === null ? '' : value).trim();
const isObjectIdLike = (value) => mongoose.Types.ObjectId.isValid(safeString(value));

const resolveProductReference = async (productIdentifier = '') => {
    const value = safeString(productIdentifier);
    if (!value) return { productId: null, productNumericId: null };

    const product = await resolveProductByIdentifier(value).catch(() => null);
    if (product?._id) {
        return {
            productId: product._id,
            productNumericId: Number(product.id || 0) || null,
        };
    }

    return {
        productId: isObjectIdLike(value) ? value : null,
        productNumericId: /^\d+$/.test(value) ? Number(value) : null,
    };
};

const recordRecommendationEvent = async ({
    userId = null,
    sessionId = '',
    eventType = '',
    productId = '',
    searchQuery = '',
    category = '',
    sourcePage = '',
    recommendationSource = '',
    metadata = {},
} = {}) => {
    const normalizedEventType = safeString(eventType);
    if (!RECOMMENDATION_EVENT_TYPES.includes(normalizedEventType)) {
        const error = new Error('Invalid recommendation event type');
        error.statusCode = 400;
        throw error;
    }

    const normalizedSessionId = safeString(sessionId || (userId ? `user-${userId}` : ''));
    if (!normalizedSessionId) {
        const error = new Error('sessionId is required for guest recommendation events');
        error.statusCode = 400;
        throw error;
    }

    const productRef = await resolveProductReference(productId);
    const dedupeTypes = new Set(['product_view', 'recommendation_impression']);
    if (dedupeTypes.has(normalizedEventType) && (productRef.productId || productRef.productNumericId)) {
        const recentCutoff = new Date(Date.now() - 10 * 60 * 1000);
        const existing = await RecommendationEvent.findOne({
            ...(userId ? { userId } : { sessionId: normalizedSessionId }),
            eventType: normalizedEventType,
            ...(productRef.productId ? { productId: productRef.productId } : { productNumericId: productRef.productNumericId }),
            sourcePage: safeString(sourcePage),
            createdAt: { $gte: recentCutoff },
        }).select('_id').lean();

        if (existing?._id) {
            return { event: existing, deduped: true };
        }
    }

    const event = await RecommendationEvent.create({
        userId: userId || null,
        sessionId: normalizedSessionId,
        productId: productRef.productId,
        productNumericId: productRef.productNumericId,
        eventType: normalizedEventType,
        searchQuery: safeString(searchQuery).slice(0, 400),
        category: safeString(category).slice(0, 120),
        sourcePage: safeString(sourcePage),
        recommendationSource: safeString(recommendationSource).slice(0, 120),
        metadata: metadata && typeof metadata === 'object' && !Array.isArray(metadata) ? metadata : {},
    });

    return { event, deduped: false };
};

module.exports = {
    recordRecommendationEvent,
    resolveProductReference,
};

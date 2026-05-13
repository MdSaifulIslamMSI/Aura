const { z } = require('zod');
const {
    RECOMMENDATION_EVENT_TYPES,
    RECOMMENDATION_SOURCE_PAGES,
} = require('../utils/recommendationConstants');

const optionalProductId = z.union([
    z.string().trim().min(1).max(120),
    z.number().int().positive(),
]).optional();

const cartItemSchema = z.object({
    productId: optionalProductId,
    id: optionalProductId,
    _id: optionalProductId,
    quantity: z.number().int().positive().max(99).optional(),
}).passthrough();

const recommendationEventSchema = z.object({
    body: z.object({
        eventType: z.enum(RECOMMENDATION_EVENT_TYPES),
        sessionId: z.string().trim().max(160).optional(),
        productId: optionalProductId,
        searchQuery: z.string().trim().max(400).optional(),
        category: z.string().trim().max(120).optional(),
        sourcePage: z.enum([...RECOMMENDATION_SOURCE_PAGES, '']).optional(),
        recommendationSource: z.string().trim().max(120).optional(),
        metadata: z.object({}).passthrough().optional(),
    }).strict(),
});

const recommendationLimitQuerySchema = z.object({
    query: z.object({
        limit: z.string().trim().regex(/^\d+$/).optional(),
        debug: z.string().trim().optional(),
    }).passthrough().optional(),
});

const similarRecommendationSchema = z.object({
    params: z.object({
        productId: z.string().trim().min(1).max(120),
    }).strict(),
    query: z.object({
        limit: z.string().trim().regex(/^\d+$/).optional(),
        debug: z.string().trim().optional(),
    }).passthrough().optional(),
});

const cartRecommendationSchema = z.object({
    body: z.object({
        cartItems: z.array(cartItemSchema).max(60).optional(),
        limit: z.number().int().positive().max(24).optional(),
    }).passthrough().optional(),
});

const searchRecommendationSchema = z.object({
    query: z.object({
        query: z.string().trim().max(300).optional(),
        q: z.string().trim().max(300).optional(),
        limit: z.string().trim().regex(/^\d+$/).optional(),
    }).passthrough().optional(),
});

const assistantRecommendationSchema = z.object({
    body: z.object({
        message: z.string().trim().max(1200).optional(),
        context: z.object({}).passthrough().optional(),
        limit: z.number().int().positive().max(12).optional(),
    }).passthrough().optional(),
});

module.exports = {
    assistantRecommendationSchema,
    cartRecommendationSchema,
    recommendationEventSchema,
    recommendationLimitQuerySchema,
    searchRecommendationSchema,
    similarRecommendationSchema,
};

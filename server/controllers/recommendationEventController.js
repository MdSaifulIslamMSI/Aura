const asyncHandler = require('express-async-handler');
const logger = require('../utils/logger');
const { recordRecommendationEvent } = require('../services/recommendationEventService');

const trackRecommendationEvent = asyncHandler(async (req, res) => {
    try {
        const { event, deduped } = await recordRecommendationEvent({
            userId: req.user?._id || null,
            sessionId: req.body?.sessionId || '',
            eventType: req.body?.eventType || '',
            productId: req.body?.productId || '',
            searchQuery: req.body?.searchQuery || '',
            category: req.body?.category || '',
            sourcePage: req.body?.sourcePage || '',
            recommendationSource: req.body?.recommendationSource || '',
            metadata: req.body?.metadata || {},
        });

        return res.status(deduped ? 200 : 201).json({
            success: true,
            deduped,
            eventId: event?._id || null,
        });
    } catch (error) {
        logger.warn('recommendation_event.track_failed', {
            eventType: req.body?.eventType,
            userId: req.user?._id?.toString?.() || '',
            error: error.message,
        });

        const statusCode = Number(error.statusCode || 0) >= 400 && Number(error.statusCode || 0) < 500
            ? Number(error.statusCode)
            : 202;
        return res.status(statusCode).json({
            success: statusCode === 202,
            tracked: false,
            message: statusCode === 202 ? 'Recommendation event accepted as best-effort telemetry.' : error.message,
        });
    }
});

module.exports = {
    trackRecommendationEvent,
};

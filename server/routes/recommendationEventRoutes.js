const express = require('express');
const validate = require('../middleware/validate');
const { protectOptional } = require('../middleware/authMiddleware');
const { createDistributedRateLimit } = require('../middleware/distributedRateLimit');
const { trackRecommendationEvent } = require('../controllers/recommendationEventController');
const { recommendationEventSchema } = require('../validators/recommendationValidators');

const router = express.Router();

const recommendationEventLimiter = createDistributedRateLimit({
    allowInMemoryFallback: process.env.NODE_ENV !== 'production',
    name: 'recommendation_event_ingest',
    securityCritical: true,
    windowMs: 60 * 1000,
    max: process.env.NODE_ENV === 'development' ? 120 : 60,
    keyGenerator: (req) => req.user?._id?.toString() || req.ip || req.socket?.remoteAddress || 'unknown',
    message: 'Too many recommendation event requests. Please slow down.',
});

router.post('/', protectOptional, recommendationEventLimiter, validate(recommendationEventSchema), trackRecommendationEvent);

module.exports = router;

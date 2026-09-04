const express = require('express');
const validate = require('../middleware/validate');
const { createDistributedRateLimit } = require('../middleware/distributedRateLimit');
const { protect, protectOptional, requireActiveAccount } = require('../middleware/authMiddleware');
const {
    getAssistant,
    getCart,
    getDebug,
    getFrequentlyBought,
    getHome,
    getRecentlyViewed,
    getSearch,
    getSimilar,
    getTrending,
} = require('../controllers/recommendationController');
const {
    assistantRecommendationSchema,
    cartRecommendationSchema,
    recommendationLimitQuerySchema,
    searchRecommendationSchema,
    similarRecommendationSchema,
} = require('../validators/recommendationValidators');

const router = express.Router();

const assistantRecommendationLimiter = createDistributedRateLimit({
    allowInMemoryFallback: process.env.NODE_ENV !== 'production',
    name: 'recommendations_assistant',
    securityCritical: true,
    windowMs: 60 * 1000,
    max: 50,
    keyGenerator: (req) => req.user?._id?.toString() || req.ip,
    message: 'Too many assistant recommendation requests. Please slow down.',
});

router.get('/home', protectOptional, validate(recommendationLimitQuerySchema), getHome);
router.get('/similar/:productId', protectOptional, validate(similarRecommendationSchema), getSimilar);
router.post('/cart', protectOptional, validate(cartRecommendationSchema), getCart);
router.get('/trending', validate(recommendationLimitQuerySchema), getTrending);
router.get('/recently-viewed', protectOptional, validate(recommendationLimitQuerySchema), getRecentlyViewed);
router.get('/search', protectOptional, validate(searchRecommendationSchema), getSearch);
router.get('/frequently-bought/:productId', validate(similarRecommendationSchema), getFrequentlyBought);
router.post('/frequently-bought', validate(cartRecommendationSchema), getFrequentlyBought);
router.post('/assistant', protectOptional, assistantRecommendationLimiter, validate(assistantRecommendationSchema), getAssistant);
router.get('/debug', protect, requireActiveAccount, validate(recommendationLimitQuerySchema), getDebug);

module.exports = router;

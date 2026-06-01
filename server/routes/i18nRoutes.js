const express = require('express');
const validate = require('../middleware/validate');
const { protectOptional } = require('../middleware/authMiddleware');
const { createDistributedRateLimit } = require('../middleware/distributedRateLimit');
const { requireAuthForHeavyTranslation } = require('../middleware/i18nTranslationPolicy');
const { translateBatch } = require('../controllers/i18nController');
const { translateBatchSchema } = require('../validators/i18nValidators');

const router = express.Router();

const i18nTranslationLimiter = createDistributedRateLimit({
    allowInMemoryFallback: process.env.NODE_ENV !== 'production',
    name: 'i18n_translate',
    securityCritical: true,
    windowMs: 60 * 1000,
    max: process.env.NODE_ENV === 'development' ? 120 : 60,
    keyGenerator: (req) => req.user?._id?.toString() || req.ip || req.socket?.remoteAddress || 'unknown',
    message: 'Too many translation requests. Please slow down.',
});

router.post(
    '/translate',
    protectOptional,
    i18nTranslationLimiter,
    validate(translateBatchSchema),
    requireAuthForHeavyTranslation,
    translateBatch
);

module.exports = router;

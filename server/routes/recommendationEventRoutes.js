const express = require('express');
const validate = require('../middleware/validate');
const { protectOptional } = require('../middleware/authMiddleware');
const { trackRecommendationEvent } = require('../controllers/recommendationEventController');
const { recommendationEventSchema } = require('../validators/recommendationValidators');

const router = express.Router();

router.post('/', protectOptional, validate(recommendationEventSchema), trackRecommendationEvent);

module.exports = router;

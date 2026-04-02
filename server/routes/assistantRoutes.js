const express = require('express');
const validate = require('../middleware/validate');
const { protectOptional } = require('../middleware/authMiddleware');
const { createDistributedRateLimit } = require('../middleware/distributedRateLimit');
const { handleAssistantTurn } = require('../controllers/assistantController');
const { assistantTurnSchema } = require('../validators/assistantValidators');

const router = express.Router();

const assistantTurnLimiter = createDistributedRateLimit({
    allowInMemoryFallback: true,
    name: 'assistant_v2_turns',
    windowMs: 60 * 1000,
    max: 45,
    keyGenerator: (req) => req.user?._id?.toString() || req.ip,
    message: 'Too many assistant workspace requests. Please slow down.',
});

router.post('/turns', protectOptional, assistantTurnLimiter, validate(assistantTurnSchema), handleAssistantTurn);

module.exports = router;

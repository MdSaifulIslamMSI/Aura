const express = require('express');
const validate = require('../middleware/validate');
const { protectOptional } = require('../middleware/authMiddleware');
const { createDistributedRateLimit } = require('../middleware/distributedRateLimit');
const {
    handleAiChat,
} = require('../controllers/aiController');
const { aiChatSchema } = require('../validators/aiValidators');

const router = express.Router();

const aiChatLimiter = createDistributedRateLimit({
    allowInMemoryFallback: true,
    name: 'ai_chat',
    windowMs: 60 * 1000,
    max: 50,
    keyGenerator: (req) => req.user?._id?.toString() || req.ip,
    message: 'Too many AI requests. Please slow down.',
});

router.post('/chat', protectOptional, aiChatLimiter, validate(aiChatSchema), handleAiChat);

module.exports = router;

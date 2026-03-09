const express = require('express');
const validate = require('../middleware/validate');
const { protectOptional } = require('../middleware/authMiddleware');
const { createDistributedRateLimit } = require('../middleware/distributedRateLimit');
const { createAiVoiceSession, handleAiChat } = require('../controllers/aiController');
const { aiChatSchema, aiVoiceSessionSchema } = require('../validators/aiValidators');

const router = express.Router();

const aiChatLimiter = createDistributedRateLimit({
    name: 'ai_chat',
    windowMs: 60 * 1000,
    max: 50,
    keyGenerator: (req) => req.user?._id?.toString() || req.ip,
    message: 'Too many AI requests. Please slow down.',
});

const aiVoiceLimiter = createDistributedRateLimit({
    name: 'ai_voice_session',
    windowMs: 60 * 1000,
    max: 20,
    keyGenerator: (req) => req.user?._id?.toString() || req.ip,
    message: 'Too many voice session requests. Please slow down.',
});

router.post('/chat', protectOptional, aiChatLimiter, validate(aiChatSchema), handleAiChat);
router.post('/voice/session', protectOptional, aiVoiceLimiter, validate(aiVoiceSessionSchema), createAiVoiceSession);

module.exports = router;

const express = require('express');
const validate = require('../middleware/validate');
const { protectOptional } = require('../middleware/authMiddleware');
const { createDistributedRateLimit } = require('../middleware/distributedRateLimit');
const { createAiVoiceSession, handleAiChat, synthesizeAiVoiceReply } = require('../controllers/aiController');
const { aiChatSchema, aiVoiceSessionSchema, aiVoiceSpeakSchema } = require('../validators/aiValidators');

const router = express.Router();

const aiChatLimiter = createDistributedRateLimit({
    allowInMemoryFallback: true,
    name: 'ai_chat',
    windowMs: 60 * 1000,
    max: 50,
    keyGenerator: (req) => req.user?._id?.toString() || req.ip,
    message: 'Too many AI requests. Please slow down.',
});

const aiVoiceLimiter = createDistributedRateLimit({
    allowInMemoryFallback: true,
    name: 'ai_voice_session',
    windowMs: 60 * 1000,
    max: 20,
    keyGenerator: (req) => req.user?._id?.toString() || req.ip,
    message: 'Too many voice session requests. Please slow down.',
});

const aiVoiceSpeechLimiter = createDistributedRateLimit({
    allowInMemoryFallback: true,
    name: 'ai_voice_speak',
    windowMs: 60 * 1000,
    max: 40,
    keyGenerator: (req) => req.user?._id?.toString() || req.ip,
    message: 'Too many voice synthesis requests. Please slow down.',
});

router.post('/chat', protectOptional, aiChatLimiter, validate(aiChatSchema), handleAiChat);
router.post('/voice/session', protectOptional, aiVoiceLimiter, validate(aiVoiceSessionSchema), createAiVoiceSession);
router.post('/voice/speak', protectOptional, aiVoiceSpeechLimiter, validate(aiVoiceSpeakSchema), synthesizeAiVoiceReply);

module.exports = router;

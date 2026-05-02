const express = require('express');
const validate = require('../middleware/validate');
const { protect, protectOptional, requireActiveAccount } = require('../middleware/authMiddleware');
const { createDistributedRateLimit } = require('../middleware/distributedRateLimit');
const {
    createAiVoiceSession,
    handleAiChat,
    handleAiChatStream,
    synthesizeAiVoiceReply,
} = require('../controllers/aiController');
const {
    listAiSessions,
    getAiSession,
    createAiSession,
    resetAiSession,
    archiveAiSession,
} = require('../controllers/aiSessionController');
const {
    aiChatSchema,
    aiSessionCreateSchema,
    aiSessionParamsOnlySchema,
    aiVoiceSessionSchema,
    aiVoiceSpeakSchema,
} = require('../validators/aiValidators');

const router = express.Router();

const parseBooleanEnv = (value, fallback = false) => {
    if (value === undefined || value === null || value === '') return fallback;
    const normalized = String(value).trim().toLowerCase();
    if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
    if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
    return fallback;
};

const publicAiAccessEnabled = parseBooleanEnv(
    process.env.AI_PUBLIC_ACCESS_ENABLED,
    process.env.NODE_ENV !== 'production'
);
const aiAccess = publicAiAccessEnabled
    ? [protectOptional]
    : [protect, requireActiveAccount];

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

const aiSessionLimiter = createDistributedRateLimit({
    allowInMemoryFallback: true,
    name: 'ai_sessions',
    windowMs: 60 * 1000,
    max: 60,
    keyGenerator: (req) => req.user?._id?.toString() || req.ip,
    message: 'Too many assistant session requests. Please slow down.',
});

router.post('/chat', ...aiAccess, aiChatLimiter, validate(aiChatSchema), handleAiChat);
router.post('/chat/stream', ...aiAccess, aiChatLimiter, validate(aiChatSchema), handleAiChatStream);
router.get('/sessions', protect, aiSessionLimiter, listAiSessions);
router.post('/sessions', protect, aiSessionLimiter, validate(aiSessionCreateSchema), createAiSession);
router.get('/sessions/:sessionId', protect, aiSessionLimiter, validate(aiSessionParamsOnlySchema), getAiSession);
router.post('/sessions/:sessionId/reset', protect, aiSessionLimiter, validate(aiSessionParamsOnlySchema), resetAiSession);
router.post('/sessions/:sessionId/archive', protect, aiSessionLimiter, validate(aiSessionParamsOnlySchema), archiveAiSession);
router.post('/voice/session', ...aiAccess, aiVoiceLimiter, validate(aiVoiceSessionSchema), createAiVoiceSession);
router.post('/voice/speak', ...aiAccess, aiVoiceSpeechLimiter, validate(aiVoiceSpeakSchema), synthesizeAiVoiceReply);

module.exports = router;

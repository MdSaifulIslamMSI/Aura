const asyncHandler = require('express-async-handler');
const AppError = require('../utils/AppError');
const { createVoiceSessionConfig, processAssistantTurn } = require('../services/ai/assistantOrchestratorService');

const handleAiChat = asyncHandler(async (req, res, next) => {
    const message = req.body?.message;
    if (!message || typeof message !== 'string') {
        return next(new AppError('Message is required', 400));
    }

    const result = await processAssistantTurn({
        user: req.user || null,
        message,
        conversationHistory: req.body?.conversationHistory || [],
        assistantMode: req.body?.assistantMode || 'chat',
        context: req.body?.context || {},
        images: req.body?.images || [],
    });

    return res.json(result);
});

const createAiVoiceSession = asyncHandler(async (req, res) => {
    const session = createVoiceSessionConfig({
        userId: req.user?._id || '',
        locale: req.body?.locale || '',
    });

    return res.status(201).json(session);
});

module.exports = {
    createAiVoiceSession,
    handleAiChat,
};

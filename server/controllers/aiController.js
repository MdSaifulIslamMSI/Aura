const asyncHandler = require('express-async-handler');
const AppError = require('../utils/AppError');
const { processAssistantTurn } = require('../services/ai/assistantOrchestratorService');

const resolveAssistantPayload = (req = {}) => ({
    user: req.user || null,
    message: typeof req.body?.message === 'string' ? req.body.message : '',
    conversationHistory: req.body?.conversationHistory || [],
    assistantMode: req.body?.assistantMode || 'chat',
    sessionId: req.body?.sessionId || '',
    confirmation: req.body?.confirmation || null,
    actionRequest: req.body?.actionRequest || null,
    context: req.body?.context || {},
    images: req.body?.images || [],
});

const handleAiChat = asyncHandler(async (req, res, next) => {
    req.clearTimeout?.();
    const payload = resolveAssistantPayload(req);
    const { message, confirmation, actionRequest } = payload;
    if (!message && !confirmation && !actionRequest) {
        return next(new AppError('Message, confirmation, or actionRequest is required', 400));
    }

    const result = await processAssistantTurn(payload);

    return res.json(result);
});

module.exports = {
    handleAiChat,
};

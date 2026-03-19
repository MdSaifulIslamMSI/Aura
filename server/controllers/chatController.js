const asyncHandler = require('express-async-handler');
const AppError = require('../utils/AppError');
const { processAssistantTurn } = require('../services/ai/assistantOrchestratorService');
const { assertPrivateChatQuota } = require('../services/chatQuotaService');

const safeString = (value, fallback = '') => String(value === undefined || value === null ? fallback : value).trim();

const buildLegacyResponse = (result, mode) => {
    const safeResult = result && typeof result === 'object' ? result : {};
    const legacy = safeResult.legacy && typeof safeResult.legacy === 'object' ? safeResult.legacy : {};
    const answer = safeString(safeResult.answer || legacy.text || "Sorry, I'm having trouble connecting. Please try again!");

    return {
        ...legacy,
        text: safeString(legacy.text || answer),
        products: Array.isArray(legacy.products) ? legacy.products : (safeResult.products || []),
        suggestions: Array.isArray(legacy.suggestions) ? legacy.suggestions : (safeResult.followUps || []),
        actionType: safeString(legacy.actionType || safeResult?.grounding?.actionType || 'assistant'),
        isAI: typeof legacy.isAI === 'boolean' ? legacy.isAI : safeResult.provider !== 'local',
        answer,
        actions: safeResult.actions || [],
        followUps: safeResult.followUps || [],
        grounding: safeResult.grounding || null,
        latencyMs: Number(safeResult.latencyMs || 0),
        provider: safeResult.provider || 'local',
        mode,
    };
};

const handlePublicChat = asyncHandler(async (req, res, next) => {
    const message = req.body?.message;

    if (!message || typeof message !== 'string') {
        return next(new AppError('Message is required', 400));
    }

    const result = await processAssistantTurn({
        user: null,
        message,
        conversationHistory: req.body?.conversationHistory || [],
        assistantMode: req.body?.assistantMode || 'chat',
        context: req.body?.context || {},
        images: req.body?.images || [],
    });

    return res.json(buildLegacyResponse(result, 'public'));
});

const handleChat = asyncHandler(async (req, res, next) => {
    const message = req.body?.message;

    if (!message || typeof message !== 'string') {
        return next(new AppError('Message is required', 400));
    }

    await assertPrivateChatQuota(req.user?._id);

    const result = await processAssistantTurn({
        user: req.user || null,
        message,
        conversationHistory: req.body?.conversationHistory || [],
        assistantMode: req.body?.assistantMode || 'chat',
        context: req.body?.context || {},
        images: req.body?.images || [],
    });

    return res.json(buildLegacyResponse(result, 'private'));
});

module.exports = { handleChat, handlePublicChat };

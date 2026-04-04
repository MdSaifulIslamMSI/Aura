const asyncHandler = require('express-async-handler');
const AppError = require('../utils/AppError');
const {
    createVoiceSessionConfig,
    processAssistantTurn,
    streamAssistantTurn,
    synthesizeVoiceReply,
} = require('../services/ai/assistantOrchestratorService');

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

const handleAiChatStream = asyncHandler(async (req, res, next) => {
    req.clearTimeout?.();
    const payload = resolveAssistantPayload(req);
    const { message, confirmation, actionRequest } = payload;
    if (!message && !confirmation && !actionRequest) {
        return next(new AppError('Message, confirmation, or actionRequest is required', 400));
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();

    const writeEvent = (eventName, data) => {
        res.write(`event: ${eventName}\n`);
        res.write(`data: ${JSON.stringify(data || {})}\n\n`);
    };

    try {
        await streamAssistantTurn({
            ...payload,
            writeEvent,
        });
        res.end();
    } catch (error) {
        writeEvent('error', {
            message: error.message || 'Streaming assistant failed',
        });
        res.end();
    }
});

const createAiVoiceSession = asyncHandler(async (req, res) => {
    const session = createVoiceSessionConfig({
        userId: req.user?._id || '',
        locale: req.body?.locale || '',
    });

    return res.status(201).json(session);
});

const synthesizeAiVoiceReply = asyncHandler(async (req, res, next) => {
    const text = req.body?.text;
    if (!text || typeof text !== 'string') {
        return next(new AppError('Text is required', 400));
    }

    const audio = await synthesizeVoiceReply({
        text,
        locale: req.body?.locale || '',
    });

    if (!audio?.audioBase64) {
        return next(new AppError('Voice synthesis is unavailable', 503));
    }

    return res.json(audio);
});

module.exports = {
    createAiVoiceSession,
    handleAiChat,
    handleAiChatStream,
    synthesizeAiVoiceReply,
};

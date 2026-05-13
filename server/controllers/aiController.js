const asyncHandler = require('express-async-handler');
const AppError = require('../utils/AppError');
const {
    processAssistantTurn,
    streamAssistantTurn,
} = require('../services/ai/commerceAssistantService');
const {
    createVoiceSessionConfig,
    synthesizeSpeech,
} = require('../services/ai/providerRegistry');
const { assertPrivateChatQuota } = require('../services/chatQuotaService');
const logger = require('../utils/logger');

const DEFAULT_AI_CHAT_TIMEOUT_MS = 25000;
const MIN_AI_CHAT_TIMEOUT_MS = 2000;
const MAX_AI_CHAT_TIMEOUT_MS = 60000;

const safeString = (value = '', fallback = '') => String(value === undefined || value === null ? fallback : value).trim();

const resolveAiChatTimeoutMs = () => {
    const parsed = Number(process.env.AI_CHAT_TIMEOUT_MS || DEFAULT_AI_CHAT_TIMEOUT_MS);
    if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_AI_CHAT_TIMEOUT_MS;
    return Math.min(MAX_AI_CHAT_TIMEOUT_MS, Math.max(MIN_AI_CHAT_TIMEOUT_MS, Math.floor(parsed)));
};

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
    audio: req.body?.audio || [],
});

const buildTimeoutAssistantResponse = ({ payload = {}, startedAt = Date.now(), timeoutMs = DEFAULT_AI_CHAT_TIMEOUT_MS } = {}) => {
    const sessionId = safeString(payload.sessionId || payload.context?.clientSessionId || '');
    const answer = 'I switched to quick catalog mode so this chat stays responsive. Try a narrower product, budget, or category and I will rerun the catalog-backed answer.';
    const followUps = ['Show trending products', 'Recommend products for me', 'Search by budget'];
    const assistantTurn = {
        intent: 'unclear',
        confidence: 0.35,
        decision: 'respond',
        response: answer,
        actions: [],
        ui: { surface: 'plain_answer' },
        contextPatch: {},
        followUps,
        safetyFlags: ['assistant_timeout_fallback'],
        verification: {
            label: 'degraded',
            confidence: 0.2,
            summary: `Assistant turn exceeded ${timeoutMs}ms and returned a structured fallback.`,
            evidenceCount: 0,
        },
        toolRuns: [{
            id: `assistant-timeout-${Date.now()}`,
            toolName: 'assistant_turn',
            status: 'timed_out',
            latencyMs: timeoutMs,
            summary: 'Assistant turn exceeded the production timeout guard.',
            inputPreview: {
                query: safeString(payload.message).slice(0, 120),
            },
            outputPreview: {
                fallback: true,
            },
        }],
    };

    return {
        answer,
        text: answer,
        products: [],
        actions: [],
        followUps,
        assistantTurn,
        grounding: {
            mode: safeString(payload.assistantMode || 'chat'),
            actionType: 'assistant',
            timeout: true,
            reason: 'assistant_timeout',
        },
        provider: 'timeout_fallback',
        providerModel: '',
        latencyMs: Date.now() - startedAt,
        sessionId,
    };
};

const runAssistantWithTimeout = async ({ work, payload, traceLabel = 'assistant.chat' } = {}) => {
    const timeoutMs = resolveAiChatTimeoutMs();
    const startedAt = Date.now();
    const workPromise = Promise.resolve().then(work);
    let timeoutId;

    const timeoutPromise = new Promise((resolve) => {
        timeoutId = setTimeout(() => {
            logger.warn(`${traceLabel}.timeout_fallback`, {
                timeoutMs,
                sessionId: safeString(payload?.sessionId || payload?.context?.clientSessionId || ''),
                messageLength: safeString(payload?.message || '').length,
            });
            workPromise.catch((error) => {
                logger.warn(`${traceLabel}.late_failure`, {
                    error: error.message,
                    timeoutMs,
                });
            });
            resolve(buildTimeoutAssistantResponse({ payload, startedAt, timeoutMs }));
        }, timeoutMs);
        timeoutId.unref?.();
    });

    try {
        return await Promise.race([workPromise, timeoutPromise]);
    } finally {
        clearTimeout(timeoutId);
    }
};

const handleAiChat = asyncHandler(async (req, res, next) => {
    req.clearTimeout?.();
    const payload = resolveAssistantPayload(req);
    const { message, confirmation, actionRequest } = payload;
    if (!message && !confirmation && !actionRequest && payload.images.length === 0 && payload.audio.length === 0) {
        return next(new AppError('Message, media, confirmation, or actionRequest is required', 400));
    }

    if (payload.user?._id) {
        await assertPrivateChatQuota(payload.user._id);
    }

    const result = await runAssistantWithTimeout({
        work: () => processAssistantTurn(payload),
        payload,
        traceLabel: 'assistant.chat',
    });

    return res.json(result);
});

const handleAiChatStream = asyncHandler(async (req, res, next) => {
    req.clearTimeout?.();
    const payload = resolveAssistantPayload(req);
    const { message, confirmation, actionRequest } = payload;
    if (!message && !confirmation && !actionRequest && payload.images.length === 0 && payload.audio.length === 0) {
        return next(new AppError('Message, media, confirmation, or actionRequest is required', 400));
    }

    if (payload.user?._id) {
        await assertPrivateChatQuota(payload.user._id);
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();

    const writeEvent = (eventName, data) => {
        if (res.writableEnded || res.destroyed) return;
        res.write(`event: ${eventName}\n`);
        res.write(`data: ${JSON.stringify(data || {})}\n\n`);
    };

    try {
        const result = await runAssistantWithTimeout({
            work: () => streamAssistantTurn({
                ...payload,
                writeEvent,
            }),
            payload,
            traceLabel: 'assistant.stream',
        });
        if (result?.provider === 'timeout_fallback') {
            const sessionId = safeString(result.sessionId || payload.sessionId || payload.context?.clientSessionId || '');
            const messageId = safeString(payload.context?.clientMessageId || `assistant-timeout-${Date.now()}`);
            writeEvent('message_meta', {
                sessionId,
                messageId,
                decision: 'respond',
                provisional: false,
                upgradeEligible: false,
                traceId: '',
            });
            writeEvent('token', { sessionId, messageId, text: result.answer });
            writeEvent('final_turn', { ...result, sessionId, messageId });
        }
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

    const audio = await synthesizeSpeech({
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

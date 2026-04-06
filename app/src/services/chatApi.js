import { aiApi } from './aiApi';

const safeString = (value = '', fallback = '') => String(value ?? fallback).trim();

const normalizeChatResponse = (response = {}, payload = {}) => {
    const assistantTurn = response?.assistantTurn;
    if (!assistantTurn || typeof assistantTurn !== 'object') {
        throw new Error('Assistant response is missing a structured turn');
    }

    const products = Array.isArray(response?.products)
        ? response.products
        : Array.isArray(assistantTurn?.ui?.products)
            ? assistantTurn.ui.products
            : [];

    return {
        assistantTurn,
        answer: safeString(response?.answer || assistantTurn?.response || ''),
        text: safeString(response?.answer || assistantTurn?.response || ''),
        provisional: Boolean(response?.provisional),
        upgradeEligible: Boolean(response?.upgradeEligible),
        decision: safeString(response?.decision || assistantTurn?.decision || ''),
        traceId: safeString(response?.traceId || response?.grounding?.traceId || ''),
        sessionId: safeString(response?.sessionId || payload?.context?.clientSessionId || ''),
        products,
        followUps: Array.isArray(response?.followUps)
            ? response.followUps
            : Array.isArray(assistantTurn?.followUps)
                ? assistantTurn.followUps
                : [],
        actions: Array.isArray(response?.actions)
            ? response.actions
            : Array.isArray(assistantTurn?.actions)
                ? assistantTurn.actions
                : [],
        provider: safeString(response?.provider || 'local'),
        providerModel: safeString(response?.providerModel || response?.providerInfo?.model || response?.provider?.model || ''),
        providerInfo: response?.providerInfo && typeof response.providerInfo === 'object'
            ? response.providerInfo
            : {
                name: safeString(response?.provider || 'local'),
                model: safeString(response?.providerModel || response?.provider?.model || ''),
            },
        mode: safeString(response?.grounding?.mode || payload?.assistantMode || 'chat'),
        latencyMs: Number(response?.latencyMs || 0),
        grounding: response?.grounding || null,
        citations: Array.isArray(assistantTurn?.citations) ? assistantTurn.citations : [],
        toolRuns: Array.isArray(assistantTurn?.toolRuns) ? assistantTurn.toolRuns : [],
        verification: assistantTurn?.verification || null,
        providerCapabilities: response?.providerCapabilities || null,
        assistantSession: response?.assistantSession || assistantTurn?.assistantSession || null,
        sessionMemory: response?.sessionMemory || assistantTurn?.sessionMemory || null,
    };
};

export const chatApi = {
    sendMessage: async (input = {}, legacyConversationHistory = []) => {
        const payload = typeof input === 'string'
            ? {
                message: input,
                conversationHistory: legacyConversationHistory,
            }
            : {
                message: input?.message || '',
                conversationHistory: Array.isArray(input?.conversationHistory) ? input.conversationHistory : [],
                assistantMode: input?.assistantMode || 'chat',
                sessionId: input?.sessionId || '',
                confirmation: input?.confirmation || undefined,
                actionRequest: input?.actionRequest || undefined,
                context: input?.context || {},
                images: Array.isArray(input?.images) ? input.images : [],
                audio: Array.isArray(input?.audio) ? input.audio : [],
            };

        const response = await aiApi.chat(payload);
        return normalizeChatResponse(response, payload);
    },
    streamMessage: async (input = {}, onEvent = () => undefined) => {
        const payload = typeof input === 'string'
            ? {
                message: input,
                conversationHistory: [],
            }
            : {
                message: input?.message || '',
                conversationHistory: Array.isArray(input?.conversationHistory) ? input.conversationHistory : [],
                assistantMode: input?.assistantMode || 'chat',
                sessionId: input?.sessionId || '',
                confirmation: input?.confirmation || undefined,
                actionRequest: input?.actionRequest || undefined,
                context: input?.context || {},
                images: Array.isArray(input?.images) ? input.images : [],
                audio: Array.isArray(input?.audio) ? input.audio : [],
            };

        let finalResponse = null;
        await aiApi.chatStream(payload, (eventName, data) => {
            if (eventName === 'final_turn') {
                finalResponse = data;
            }
            if (typeof onEvent === 'function') {
                onEvent(eventName, data);
            }
        });

        if (!finalResponse) {
            throw new Error('Assistant stream ended before a final turn was received');
        }

        return normalizeChatResponse(finalResponse, payload);
    },
};

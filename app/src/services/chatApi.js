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
        mode: safeString(response?.grounding?.mode || payload?.assistantMode || 'chat'),
        latencyMs: Number(response?.latencyMs || 0),
        grounding: response?.grounding || null,
        providerCapabilities: response?.providerCapabilities || null,
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
                context: input?.context || {},
                images: Array.isArray(input?.images) ? input.images : [],
            };

        const response = await aiApi.chat(payload);
        return normalizeChatResponse(response, payload);
    }
};

import { aiApi } from './aiApi';

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

        try {
            const response = await aiApi.chat(payload);
            if (response?.legacy && typeof response.legacy === 'object') {
                return {
                    ...response.legacy,
                    assistantTurn: response?.assistantTurn || null,
                    answer: response?.answer || response.legacy?.text || '',
                    actions: response?.actions || [],
                    followUps: response?.followUps || response.legacy?.suggestions || [],
                    provider: response?.provider || response.legacy?.provider || 'local',
                    mode: response?.grounding?.mode || response.legacy?.mode || payload.assistantMode || 'chat',
                    latencyMs: response?.latencyMs || 0,
                    grounding: response?.grounding || null,
                    providerCapabilities: response?.providerCapabilities || null,
                };
            }
            return {
                text: response?.answer || "Sorry, I'm having trouble connecting. Please try again!",
                answer: response?.answer || "Sorry, I'm having trouble connecting. Please try again!",
                products: response?.products || [],
                suggestions: response?.followUps || [],
                followUps: response?.followUps || [],
                actions: response?.actions || [],
                assistantTurn: response?.assistantTurn || null,
                actionType: response?.grounding?.actionType || 'assistant',
                isAI: response?.provider !== 'local',
                provider: response?.provider || 'local',
                mode: response?.grounding?.mode || 'chat',
                latencyMs: response?.latencyMs || 0,
                grounding: response?.grounding || null,
                providerCapabilities: response?.providerCapabilities || null,
            };
        } catch (error) {
            console.error("Chat Error:", error);
            return {
                text: "Sorry, I'm having trouble connecting. Please try again!",
                answer: "Sorry, I'm having trouble connecting. Please try again!",
                products: [],
                suggestions: ['Best deals today', 'Search premium phones', 'Build a smart bundle'],
                followUps: ['Best deals today', 'Search premium phones', 'Build a smart bundle'],
                actions: [],
                assistantTurn: null,
                actionType: 'error',
                isAI: false,
                provider: 'local',
                mode: 'chat',
                latencyMs: 0,
            };
        }
    }
};

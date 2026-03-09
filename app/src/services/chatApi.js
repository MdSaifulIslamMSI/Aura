import { aiApi } from './aiApi';

export const chatApi = {
    sendMessage: async (message, conversationHistory = []) => {
        try {
            const response = await aiApi.chat({
                message,
                assistantMode: 'chat',
                conversationHistory,
            });
            if (response?.legacy && typeof response.legacy === 'object') {
                return response.legacy;
            }
            return {
                text: response?.answer || "Sorry, I'm having trouble connecting. Please try again!",
                products: response?.products || [],
                suggestions: response?.followUps || [],
                actionType: response?.grounding?.actionType || 'assistant',
                isAI: response?.provider !== 'local',
                provider: response?.provider || 'local',
                mode: response?.grounding?.mode || 'chat',
            };
        } catch (error) {
            console.error("Chat Error:", error);
            return {
                text: "Sorry, I'm having trouble connecting. Please try again!",
                products: [],
                suggestions: ['🔥 Best deals', '📱 Latest phones', '💻 Top laptops'],
                actionType: 'error',
                isAI: false
            };
        }
    }
};

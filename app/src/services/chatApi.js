const API_URL = import.meta.env.VITE_API_URL || '/api';
import { auth } from '../config/firebase';

const getChatHeaders = async () => {
    const headers = { 'Content-Type': 'application/json' };
    const user = auth.currentUser;
    if (!user) return { headers, endpoint: '/chat/public' };

    try {
        const token = await user.getIdToken();
        return {
            headers: {
                ...headers,
                Authorization: `Bearer ${token}`,
            },
            endpoint: '/chat',
        };
    } catch {
        return { headers, endpoint: '/chat/public' };
    }
};

export const chatApi = {
    sendMessage: async (message, conversationHistory = []) => {
        try {
            const { headers, endpoint } = await getChatHeaders();
            let response = await fetch(`${API_URL}${endpoint}`, {
                method: 'POST',
                headers,
                body: JSON.stringify({ message, conversationHistory })
            });

            // If private endpoint returns unauthorized, retry in public mode.
            if (response.status === 401 || response.status === 403) {
                response = await fetch(`${API_URL}/chat/public`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ message, conversationHistory }),
                });
            }

            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            return await response.json();
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

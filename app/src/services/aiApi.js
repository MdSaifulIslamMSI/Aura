import { auth, isFirebaseReady } from '../config/firebase';
import {
    API_BASE_URL as API_URL,
    buildApiUrl,
    createResponseError,
    parseJsonSafely,
    requestWithTrace,
} from './apiBase';

const buildBaseHeaders = () => ({
    Accept: 'application/json',
    'Content-Type': 'application/json',
});

const getAiRequestConfig = async () => {
    const headers = buildBaseHeaders();
    if (!isFirebaseReady || !auth) {
        return { headers, usedAuth: false };
    }

    const user = auth.currentUser;
    if (!user) {
        return { headers, usedAuth: false };
    }

    try {
        const token = await user.getIdToken();
        return {
            headers: {
                ...headers,
                Authorization: `Bearer ${token}`,
            },
            usedAuth: true,
        };
    } catch {
        return { headers, usedAuth: false };
    }
};

const requestAiJson = async (path, payload = {}, options = {}) => {
    const { method = 'POST', fallbackMessage = 'AI request failed' } = options;
    const { headers, usedAuth } = await getAiRequestConfig();

    let response = await requestWithTrace(`${API_URL}${path}`, {
        method,
        headers,
        body: method === 'GET' ? undefined : JSON.stringify(payload),
        throwOnHttpError: false,
        fallbackMessage,
    });

    if (usedAuth && (response.status === 401 || response.status === 403)) {
        response = await requestWithTrace(`${API_URL}${path}`, {
            method,
            headers: buildBaseHeaders(),
            body: method === 'GET' ? undefined : JSON.stringify(payload),
            throwOnHttpError: false,
            fallbackMessage,
        });
    }

    if (!response.ok) {
        throw await createResponseError(response, fallbackMessage, {
            method,
            url: `${API_URL}${path}`,
        });
    }

    return parseJsonSafely(response);
};

export const aiApi = {
    chat: async (payload = {}) => requestAiJson('/ai/chat', payload, {
        fallbackMessage: 'Aura AI is unavailable right now',
    }),
    createVoiceSession: async (payload = {}) => requestAiJson('/ai/voice/session', payload, {
        fallbackMessage: 'Voice session could not be created',
    }),
    speakText: async (payload = {}) => {
        const { headers, usedAuth } = await getAiRequestConfig();
        const url = buildApiUrl('/ai/voice/speak');

        let response = await requestWithTrace(url, {
            method: 'POST',
            headers,
            body: JSON.stringify(payload),
            throwOnHttpError: false,
            fallbackMessage: 'Voice synthesis failed',
        });

        if (usedAuth && (response.status === 401 || response.status === 403)) {
            response = await requestWithTrace(url, {
                method: 'POST',
                headers: buildBaseHeaders(),
                body: JSON.stringify(payload),
                throwOnHttpError: false,
                fallbackMessage: 'Voice synthesis failed',
            });
        }

        if (!response.ok) {
            throw await createResponseError(response, 'Voice synthesis failed', {
                method: 'POST',
                url,
            });
        }

        return parseJsonSafely(response);
    },
};

export default aiApi;

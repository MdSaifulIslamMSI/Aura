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

const consumeEventStream = async (response, onEvent) => {
    const reader = response.body?.getReader?.();
    if (!reader) {
        return;
    }

    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const frames = buffer.split('\n\n');
        buffer = frames.pop() || '';

        frames.forEach((frame) => {
            const eventLine = frame.split('\n').find((line) => line.startsWith('event:'));
            const dataLine = frame.split('\n').find((line) => line.startsWith('data:'));
            const eventName = String(eventLine || '').replace(/^event:\s*/, '').trim() || 'message';
            const rawData = String(dataLine || '').replace(/^data:\s*/, '').trim();

            if (!rawData || typeof onEvent !== 'function') {
                return;
            }

            try {
                onEvent(eventName, JSON.parse(rawData));
            } catch {
                onEvent(eventName, { raw: rawData });
            }
        });
    }
};

export const aiApi = {
    chat: async (payload = {}) => requestAiJson('/ai/chat', payload, {
        fallbackMessage: 'Aura AI is unavailable right now',
    }),
    chatStream: async (payload = {}, onEvent = () => undefined) => {
        const { headers, usedAuth } = await getAiRequestConfig();
        const url = buildApiUrl('/ai/chat/stream');

        const execute = async (requestHeaders) => requestWithTrace(url, {
            method: 'POST',
            headers: requestHeaders,
            body: JSON.stringify(payload),
            throwOnHttpError: false,
            fallbackMessage: 'Aura AI stream is unavailable right now',
        });

        let response = await execute(headers);
        if (usedAuth && (response.status === 401 || response.status === 403)) {
            response = await execute(buildBaseHeaders());
        }

        if (!response.ok) {
            throw await createResponseError(response, 'Aura AI stream is unavailable right now', {
                method: 'POST',
                url,
            });
        }

        await consumeEventStream(response, onEvent);
    },
    createVoiceSession: async (payload = {}) => requestAiJson('/ai/voice/session', payload, {
        fallbackMessage: 'Voice session could not be created',
    }),
    listSessions: async () => requestAiJson('/ai/sessions', {}, {
        method: 'GET',
        fallbackMessage: 'Assistant history is unavailable right now',
    }),
    getSession: async (sessionId = '') => requestAiJson(`/ai/sessions/${encodeURIComponent(String(sessionId || '').trim())}`, {}, {
        method: 'GET',
        fallbackMessage: 'Assistant session is unavailable right now',
    }),
    createSession: async (payload = {}) => requestAiJson('/ai/sessions', payload, {
        fallbackMessage: 'Assistant session could not be created',
    }),
    resetSession: async (sessionId = '') => requestAiJson(`/ai/sessions/${encodeURIComponent(String(sessionId || '').trim())}/reset`, {}, {
        fallbackMessage: 'Assistant session could not be reset',
    }),
    archiveSession: async (sessionId = '') => requestAiJson(`/ai/sessions/${encodeURIComponent(String(sessionId || '').trim())}/archive`, {}, {
        fallbackMessage: 'Assistant session could not be archived',
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

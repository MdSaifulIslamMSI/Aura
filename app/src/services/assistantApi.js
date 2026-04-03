import { auth, isFirebaseReady } from '@/config/firebase';
import {
    createResponseError,
    parseJsonSafely,
    requestWithTrace,
} from './apiBase';

const buildBaseHeaders = () => ({
    Accept: 'application/json',
    'Content-Type': 'application/json',
});

const getAssistantRequestConfig = async () => {
    const headers = buildBaseHeaders();
    if (!isFirebaseReady || !auth?.currentUser) {
        return {
            headers,
            usedAuth: false,
        };
    }

    try {
        const token = await auth.currentUser.getIdToken();
        return {
            headers: {
                ...headers,
                Authorization: `Bearer ${token}`,
            },
            usedAuth: true,
        };
    } catch {
        return {
            headers,
            usedAuth: false,
        };
    }
};

const requestAssistantJson = async (path, payload = {}, fallbackMessage = 'Assistant workspace is unavailable right now') => {
    const { headers, usedAuth } = await getAssistantRequestConfig();

    let response = await requestWithTrace(`/api${path}`, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
        throwOnHttpError: false,
        fallbackMessage,
    });

    if (usedAuth && (response.status === 401 || response.status === 403)) {
        response = await requestWithTrace(`/api${path}`, {
            method: 'POST',
            headers: buildBaseHeaders(),
            body: JSON.stringify(payload),
            throwOnHttpError: false,
            fallbackMessage,
        });
    }

    if (!response.ok) {
        throw await createResponseError(response, fallbackMessage, {
            method: 'POST',
            url: `/api${path}`,
        });
    }

    return parseJsonSafely(response);
};

const normalizeAssistantTurnResponse = (response = {}) => ({
    session: {
        id: String(response?.session?.id || '').trim(),
        expiresAt: String(response?.session?.expiresAt || '').trim(),
    },
    reply: {
        text: String(response?.reply?.text || '').trim(),
        intent: String(response?.reply?.intent || 'general_help').trim(),
        confidence: Math.min(Math.max(Number(response?.reply?.confidence || 0), 0), 1),
    },
    cards: Array.isArray(response?.cards) ? response.cards : [],
    actions: Array.isArray(response?.actions) ? response.actions : [],
    supportDraft: response?.supportDraft && typeof response.supportDraft === 'object'
        ? response.supportDraft
        : null,
    telemetry: {
        latencyMs: Math.max(0, Number(response?.telemetry?.latencyMs || 0)),
        source: String(response?.telemetry?.source || 'rules').trim(),
        retrievalHits: Math.max(0, Number(response?.telemetry?.retrievalHits || 0)),
    },
});

export const assistantApi = {
    createTurn: async (payload = {}) => {
        const response = await requestAssistantJson('/assistant/turns', payload);
        return normalizeAssistantTurnResponse(response);
    },
};

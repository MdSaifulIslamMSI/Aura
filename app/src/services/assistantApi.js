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
        route: String(response?.telemetry?.route || '').trim(),
        traceId: String(response?.telemetry?.traceId || '').trim(),
        decisionId: String(response?.telemetry?.decisionId || '').trim(),
        provisional: Boolean(response?.telemetry?.provisional),
        upgradeEligible: Boolean(response?.telemetry?.upgradeEligible),
    },
    decision: response?.decision && typeof response.decision === 'object'
        ? {
            route: String(response.decision.route || '').trim(),
            confidence: Math.min(Math.max(Number(response.decision.confidence || 0), 0), 1),
            costEstimate: Math.max(0, Number(response.decision.costEstimate || 0)),
            latencyBudgetMs: Math.max(0, Number(response.decision.latencyBudgetMs || 0)),
            requiresConfirmation: Boolean(response.decision.requiresConfirmation),
            reasonSummary: String(response.decision.reasonSummary || '').trim(),
        }
        : null,
    provisional: Boolean(response?.provisional),
    traceId: String(response?.traceId || '').trim(),
    decisionId: String(response?.decisionId || '').trim(),
    upgradeEligible: Boolean(response?.upgradeEligible),
    provisionalReply: response?.provisionalReply && typeof response.provisionalReply === 'object'
        ? {
            text: String(response.provisionalReply.text || '').trim(),
            intent: String(response.provisionalReply.intent || 'general_help').trim(),
            confidence: Math.min(Math.max(Number(response.provisionalReply.confidence || 0), 0), 1),
        }
        : null,
});

export const assistantApi = {
    createTurn: async (payload = {}) => {
        const response = await requestAssistantJson('/assistant/turns', payload);
        return normalizeAssistantTurnResponse(response);
    },
};

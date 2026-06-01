import { apiFetch, API_BASE_URL as BASE_URL } from '../apiBase';
import { getActiveMarketHeaders } from '../marketRuntime';
import { createRuntimeId } from '../../utils/runtimeId';
import { getAuthHeader } from './apiUtils';

const RECOMMENDATION_SESSION_KEY = 'aura_recommendation_session_id';

const createRecommendationSessionId = () => createRuntimeId('rec');

export const getRecommendationSessionId = () => {
    if (typeof window === 'undefined') return '';
    try {
        const existing = window.localStorage.getItem(RECOMMENDATION_SESSION_KEY);
        if (existing) return existing;
        const nextSessionId = createRecommendationSessionId();
        window.localStorage.setItem(RECOMMENDATION_SESSION_KEY, nextSessionId);
        return nextSessionId;
    } catch {
        return createRecommendationSessionId();
    }
};

const withSessionParams = (params = {}) => ({
    ...params,
    sessionId: getRecommendationSessionId(),
});

const unwrapRecommendations = (payload = {}) => ({
    ...payload,
    recommendations: Array.isArray(payload?.recommendations) ? payload.recommendations : [],
});

const productIdOf = (product = {}) => product?.id || product?._id || product?.productId || '';

const hasAuthorizationHeader = (headers = {}) => Object.entries(headers || {}).some(
    ([key, value]) => key.toLowerCase() === 'authorization' && String(value || '').trim()
);

const buildOptionalAuthRequestOptions = (headers = {}, options = {}) => ({
    headers,
    credentials: hasAuthorizationHeader(headers) ? (options.credentials ?? 'include') : 'omit',
    signal: options.signal,
});

export const decorateRecommendedProduct = (entry = {}) => ({
    ...(entry.product || entry),
    recommendationMeta: {
        score: entry.score,
        reason: entry.reason || '',
        source: entry.source || '',
    },
});

export const trackRecommendationEvent = async (payload = {}) => {
    const eventType = String(payload?.eventType || '').trim();
    if (!eventType) return null;

    try {
        const headers = {
            'Accept': 'application/json',
            'Content-Type': 'application/json',
            'x-recommendation-session-id': getRecommendationSessionId(),
            ...getActiveMarketHeaders(),
            ...(await getAuthHeader()),
        };
        const body = JSON.stringify({
            sessionId: getRecommendationSessionId(),
            eventType,
            productId: payload.productId || productIdOf(payload.product) || '',
            searchQuery: payload.searchQuery || '',
            category: payload.category || payload.product?.category || '',
            sourcePage: payload.sourcePage || '',
            recommendationSource: payload.recommendationSource || payload.product?.recommendationMeta?.source || '',
            metadata: payload.metadata || {},
        });

        const response = await fetch(`${BASE_URL}/recommendation-events`, {
            method: 'POST',
            keepalive: body.length < 60000,
            headers,
            body,
        });
        return response.ok;
    } catch {
        return null;
    }
};

export const recommendationApi = {
    getHomeRecommendations: async (params = {}, options = {}) => {
        const headers = await getAuthHeader();
        const { data } = await apiFetch('/recommendations/home', {
            method: 'GET',
            params: withSessionParams(params),
            ...buildOptionalAuthRequestOptions(headers, options),
        });
        return unwrapRecommendations(data);
    },
    getSimilarProducts: async (productId, params = {}, options = {}) => {
        const headers = await getAuthHeader();
        const { data } = await apiFetch(`/recommendations/similar/${productId}`, {
            method: 'GET',
            params: withSessionParams(params),
            ...buildOptionalAuthRequestOptions(headers, options),
        });
        return unwrapRecommendations(data);
    },
    getCartRecommendations: async ({ cartItems = [], limit = 8 } = {}, options = {}) => {
        const headers = await getAuthHeader();
        const { data } = await apiFetch('/recommendations/cart', {
            method: 'POST',
            params: withSessionParams({}),
            ...buildOptionalAuthRequestOptions(headers, options),
            body: JSON.stringify({
                sessionId: getRecommendationSessionId(),
                cartItems,
                limit,
            }),
        });
        return unwrapRecommendations(data);
    },
    getTrendingProducts: async (params = {}, options = {}) => {
        const { data } = await apiFetch('/recommendations/trending', {
            method: 'GET',
            params,
            signal: options.signal,
        });
        return unwrapRecommendations(data);
    },
    getRecentlyViewedRecommendations: async (params = {}, options = {}) => {
        const headers = await getAuthHeader();
        const { data } = await apiFetch('/recommendations/recently-viewed', {
            method: 'GET',
            params: withSessionParams(params),
            ...buildOptionalAuthRequestOptions(headers, options),
        });
        return unwrapRecommendations(data);
    },
    getSearchRecommendations: async ({ query = '', limit = 8 } = {}, options = {}) => {
        const headers = await getAuthHeader();
        const { data } = await apiFetch('/recommendations/search', {
            method: 'GET',
            params: withSessionParams({ query, limit }),
            ...buildOptionalAuthRequestOptions(headers, options),
        });
        return unwrapRecommendations(data);
    },
    getFrequentlyBoughtTogether: async (productId, params = {}, options = {}) => {
        const { data } = await apiFetch(`/recommendations/frequently-bought/${productId}`, {
            method: 'GET',
            params,
            signal: options.signal,
        });
        return unwrapRecommendations(data);
    },
    getAssistantRecommendations: async ({ message = '', context = {}, limit = 5 } = {}, options = {}) => {
        const headers = await getAuthHeader();
        const { data } = await apiFetch('/recommendations/assistant', {
            method: 'POST',
            params: withSessionParams({}),
            ...buildOptionalAuthRequestOptions(headers, options),
            body: JSON.stringify({
                sessionId: getRecommendationSessionId(),
                message,
                context,
                limit,
            }),
        });
        return unwrapRecommendations(data);
    },
};

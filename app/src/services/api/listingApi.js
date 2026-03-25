import { apiFetch, API_BASE_URL as BASE_URL } from '../apiBase';
import { getAuthHeader, createIdempotencyKey, runWhenIdle } from './apiUtils';

const prefetchedListingIds = new Set();

export const listingApi = {
    getListings: async (params = {}) => {
        const headers = await getAuthHeader();
        const { data } = await apiFetch('/listings', { headers, params });
        return data;
    },
    getListingById: async (id) => {
        const headers = await getAuthHeader();
        const { data } = await apiFetch(`/listings/${id}`, { headers });
        return data;
    },
    createListing: async (payload) => {
        const headers = await getAuthHeader();
        const { data } = await apiFetch('/listings', {
            method: 'POST',
            headers,
            body: JSON.stringify(payload),
        });
        return data;
    },
    updateListing: async (id, payload) => {
        const headers = await getAuthHeader();
        const { data } = await apiFetch(`/listings/${id}`, {
            method: 'PUT',
            headers,
            body: JSON.stringify(payload),
        });
        return data;
    },
    deleteListing: async (id) => {
        const headers = await getAuthHeader();
        const { data } = await apiFetch(`/listings/${id}`, {
            method: 'DELETE',
            headers,
        });
        return data;
    },
    getHotspots: async (params = {}) => {
        try {
            const { data } = await apiFetch('/listings/hotspots', { params });
            return data;
        } catch (error) {
            // Candidate path retry for potentially misrouted hotspots
            if (error?.status === 404) {
                const { data } = await apiFetch('/hotspots', { params });
                return data;
            }
            throw error;
        }
    },
    prefetchListingById: (id) => {
        const normalizedId = id == null ? '' : String(id).trim();
        if (!normalizedId || prefetchedListingIds.has(normalizedId)) return;
        prefetchedListingIds.add(normalizedId);

        runWhenIdle(async () => {
            try {
                await apiFetch(`/listings/${normalizedId}`);
            } catch {
                // Best effort
            }
        });
    },
    markSold: async (id) => {
        const headers = await getAuthHeader();
        const { data } = await apiFetch(`/listings/${id}/sold`, {
            method: 'PATCH',
            headers,
        });
        return data;
    },
    getMyListings: async () => {
        const headers = await getAuthHeader();
        const { data } = await apiFetch('/listings/my', { headers });
        return data;
    },
    getSellerProfile: async (userId) => {
        const headers = await getAuthHeader();
        const { data } = await apiFetch(`/listings/seller/${userId}`, { headers });
        return data;
    },
    createEscrowIntent: async (id, payload = {}) => {
        const headers = await getAuthHeader();
        const { data } = await apiFetch(`/listings/${id}/escrow/intents`, {
            method: 'POST',
            headers: {
                ...headers,
                'Idempotency-Key': payload?.idempotencyKey || createIdempotencyKey('escrow-intent'),
            },
            body: JSON.stringify(payload),
        });
        return data;
    },
    confirmEscrowIntent: async (id, intentId, payload = {}) => {
        const headers = await getAuthHeader();
        const { data } = await apiFetch(`/listings/${id}/escrow/intents/${intentId}/confirm`, {
            method: 'POST',
            headers: {
                ...headers,
                'Idempotency-Key': payload?.idempotencyKey || createIdempotencyKey('escrow-confirm'),
            },
            body: JSON.stringify(payload),
        });
        return data;
    },
    startEscrow: async (id, payload = {}) => {
        const headers = await getAuthHeader();
        const { data } = await apiFetch(`/listings/${id}/escrow/start`, {
            method: 'PATCH',
            headers,
            body: JSON.stringify(payload),
        });
        return data;
    },
    confirmEscrow: async (id) => {
        const headers = await getAuthHeader();
        const { data } = await apiFetch(`/listings/${id}/escrow/confirm`, {
            method: 'PATCH',
            headers,
        });
        return data;
    },
    cancelEscrow: async (id) => {
        const headers = await getAuthHeader();
        const { data } = await apiFetch(`/listings/${id}/escrow/cancel`, {
            method: 'PATCH',
            headers,
        });
        return data;
    },
    getMessageInbox: async () => {
        const headers = await getAuthHeader();
        const { data } = await apiFetch('/listings/messages/inbox', { headers });
        return data;
    },
    sendListingMessage: async (id, payload) => {
        const headers = await getAuthHeader();
        const { data } = await apiFetch(`/listings/${id}/messages`, {
            method: 'POST',
            headers,
            body: JSON.stringify(payload),
        });
        return data;
    },
    getListingMessages: async (id, params = {}) => {
        const headers = await getAuthHeader();
        const { data } = await apiFetch(`/listings/${id}/messages`, { headers, params });
        return data;
    },
    startVideoSession: async (id) => {
        const headers = await getAuthHeader();
        const { data } = await apiFetch(`/listings/${id}/video/start`, {
            method: 'POST',
            headers,
            body: JSON.stringify({}),
        });
        return data;
    },
    joinVideoSession: async (id, payload = {}) => {
        const headers = await getAuthHeader();
        const { data } = await apiFetch(`/listings/${id}/video/join`, {
            method: 'POST',
            headers,
            body: JSON.stringify(payload),
        });
        return data;
    },
    markVideoSessionConnected: async (id, payload = {}) => {
        const headers = await getAuthHeader();
        const { data } = await apiFetch(`/listings/${id}/video/connected`, {
            method: 'POST',
            headers,
            body: JSON.stringify(payload),
        });
        return data;
    },
    endVideoSession: async (id, payload = {}) => {
        const headers = await getAuthHeader();
        const { data } = await apiFetch(`/listings/${id}/video/end`, {
            method: 'POST',
            headers,
            body: JSON.stringify(payload),
        });
        return data;
    }
};

export const tradeInApi = {
    estimate: async (payload) => {
        const headers = await getAuthHeader();
        const { data } = await apiFetch('/trade-in/estimate', {
            method: 'POST',
            headers,
            body: JSON.stringify(payload),
        });
        return data;
    },
    tradeInEstimate: async (payload) => {
        const headers = await getAuthHeader();
        const { data } = await apiFetch('/trade-in/estimate', {
            method: 'POST',
            headers,
            body: JSON.stringify(payload),
        });
        return data;
    },
    create: async (payload) => {
        const headers = await getAuthHeader();
        const { data } = await apiFetch('/trade-in', {
            method: 'POST',
            headers,
            body: JSON.stringify(payload),
        });
        return data;
    },
    createTradeIn: async (payload) => {
        const headers = await getAuthHeader();
        const { data = {} } = await apiFetch('/trade-in', {
            method: 'POST',
            headers,
            body: JSON.stringify(payload),
        });
        return data;
    },
    getMyTradeIns: async () => {
        const headers = await getAuthHeader();
        const { data = {} } = await apiFetch('/trade-in/my', { headers });
        return data;
    },
    cancel: async (id) => {
        const headers = await getAuthHeader();
        const { data = {} } = await apiFetch(`/trade-in/${id}`, {
            method: 'DELETE',
            headers,
        });
        return data;
    }
};

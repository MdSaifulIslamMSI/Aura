import { apiFetch, API_BASE_URL as BASE_URL } from '../apiBase';
import { getAuthHeader, createIdempotencyKey, runWhenIdle } from './apiUtils';

const prefetchedListingIds = new Set();

export const listingApi = {
    getListings: async (params = {}) => {
        const { data } = await apiFetch('/listings', { params });
        return data;
    },
    getListingById: async (id) => {
        const { data } = await apiFetch(`/listings/${id}`);
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
    getMyListings: async () => {
        const headers = await getAuthHeader();
        const { data } = await apiFetch('/listings/my', { headers });
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
    create: async (payload) => {
        const headers = await getAuthHeader();
        const { data } = await apiFetch('/trade-in', {
            method: 'POST',
            headers,
            body: JSON.stringify(payload),
        });
        return data;
    }
};

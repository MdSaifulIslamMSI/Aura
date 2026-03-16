import { apiFetch } from '../apiBase';
import { getAuthHeader } from './apiUtils';

export const intelligenceApi = {
    optimizeRewards: async () => {
        const headers = await getAuthHeader();
        const { data } = await apiFetch('/intelligence/optimize-rewards', {
            method: 'POST',
            headers,
        });
        return data;
    },
    getLatestRewards: async () => {
        const headers = await getAuthHeader();
        const { data } = await apiFetch('/intelligence/latest-rewards', { headers });
        return data;
    }
};

export const priceAlertApi = {
    create: async (productId, targetPrice) => {
        const headers = await getAuthHeader();
        const { data } = await apiFetch('/price-alerts', {
            method: 'POST',
            headers,
            body: JSON.stringify({ productId, targetPrice }),
        });
        return data;
    },
    getMyAlerts: async () => {
        const headers = await getAuthHeader();
        const { data } = await apiFetch('/price-alerts/my', { headers });
        return data;
    },
    delete: async (id) => {
        const headers = await getAuthHeader();
        const { data } = await apiFetch(`/price-alerts/${id}`, {
            method: 'DELETE',
            headers,
        });
        return data;
    },
    getHistory: async (productId) => {
        const { data } = await apiFetch(`/price-alerts/history/${productId}`);
        return data;
    }
};

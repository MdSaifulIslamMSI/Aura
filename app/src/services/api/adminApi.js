import { apiFetch } from '../apiBase';
import { getAuthHeader } from './apiUtils';

export const adminApi = {
    getAnalyticsOverview: async (params = {}) => {
        const headers = await getAuthHeader();
        const { data } = await apiFetch('/admin/analytics/overview', { headers, params });
        return data;
    },
    listUsers: async (params = {}) => {
        const headers = await getAuthHeader();
        const { data } = await apiFetch('/admin/users', { headers, params });
        return data;
    },
    getUserDetails: async (userId) => {
        const headers = await getAuthHeader();
        const { data } = await apiFetch(`/admin/users/${userId}`, { headers });
        return data;
    },
    warnUser: async (userId, payload = {}) => {
        const headers = await getAuthHeader();
        const { data } = await apiFetch(`/admin/users/${userId}/warn`, {
            method: 'POST',
            headers,
            body: JSON.stringify(payload),
        });
        return data;
    },
    suspendUser: async (userId, payload = {}) => {
        const headers = await getAuthHeader();
        const { data } = await apiFetch(`/admin/users/${userId}/suspend`, {
            method: 'POST',
            headers,
            body: JSON.stringify(payload),
        });
        return data;
    },
    getProducts: async (params = {}) => {
        const headers = await getAuthHeader();
        const { data } = await apiFetch('/admin/products', { headers, params });
        return data;
    }
};

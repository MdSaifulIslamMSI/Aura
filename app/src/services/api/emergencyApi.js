import { apiFetch } from '../apiBase';
import { getAuthHeader } from './apiUtils';

export const emergencyApi = {
    getStatus: async () => {
        const { data } = await apiFetch('/emergency/status', {
            cache: 'no-store',
            timeoutMs: 8000,
        });
        return data;
    },
    listAdminControls: async () => {
        const headers = await getAuthHeader();
        const { data } = await apiFetch('/admin/emergency-controls', { headers, cache: 'no-store' });
        return data;
    },
    listAudit: async (params = {}) => {
        const headers = await getAuthHeader();
        const { data } = await apiFetch('/admin/emergency-controls/audit', { headers, params, cache: 'no-store' });
        return data;
    },
    activate: async (key, payload = {}) => {
        const headers = await getAuthHeader();
        const { data } = await apiFetch(`/admin/emergency-controls/${key}/activate`, {
            method: 'POST',
            headers,
            body: JSON.stringify(payload),
        });
        return data;
    },
    deactivate: async (key, payload = {}) => {
        const headers = await getAuthHeader();
        const { data } = await apiFetch(`/admin/emergency-controls/${key}/deactivate`, {
            method: 'POST',
            headers,
            body: JSON.stringify(payload),
        });
        return data;
    },
    extend: async (key, payload = {}) => {
        const headers = await getAuthHeader();
        const { data } = await apiFetch(`/admin/emergency-controls/${key}/extend`, {
            method: 'POST',
            headers,
            body: JSON.stringify(payload),
        });
        return data;
    },
    updateMessage: async (key, payload = {}) => {
        const headers = await getAuthHeader();
        const { data } = await apiFetch(`/admin/emergency-controls/${key}/message`, {
            method: 'PATCH',
            headers,
            body: JSON.stringify(payload),
        });
        return data;
    },
};

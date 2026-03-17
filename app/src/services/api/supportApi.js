import { apiFetch } from '../apiBase';
import { getAuthHeader } from './apiUtils';

export const supportApi = {
    // User endpoints
    createTicket: async (payload) => {
        const headers = await getAuthHeader();
        const { data } = await apiFetch(`/support`, { method: 'POST', headers, body: JSON.stringify(payload) });
        return data;
    },
    getTickets: async (params) => {
        const headers = await getAuthHeader();
        const { data } = await apiFetch(`/support`, { headers, params });
        return data;
    },
    getMessages: async (ticketId) => {
        const headers = await getAuthHeader();
        const { data } = await apiFetch(`/support/${ticketId}/messages`, { headers });
        return data;
    },
    sendMessage: async (ticketId, message) => {
        const headers = await getAuthHeader();
        const { data } = await apiFetch(`/support/${ticketId}/messages`, { method: 'POST', headers, body: JSON.stringify({ message }) });
        return data;
    },

    // Admin endpoints
    adminGetTickets: async (params) => {
        const headers = await getAuthHeader();
        const { data } = await apiFetch(`/support/admin/all`, { headers, params });
        return data;
    },
    adminUpdateStatus: async (ticketId, status) => {
        const headers = await getAuthHeader();
        const { data } = await apiFetch(`/support/${ticketId}/status`, { method: 'PATCH', headers, body: JSON.stringify({ status }) });
        return data;
    },
};

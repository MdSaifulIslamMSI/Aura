import { apiFetch } from '../apiBase';
import { getAuthHeader } from './apiUtils';

export const notificationApi = {
    getNotifications: async (params) => {
        const headers = await getAuthHeader();
        const { data } = await apiFetch('/notifications', { headers, params });
        return data; 
    },
    
    markAsRead: async (notificationIds) => {
        const headers = await getAuthHeader();
        const { data } = await apiFetch('/notifications/read', { 
            method: 'PUT',
            headers,
            body: JSON.stringify({ notificationIds }) 
        });
        return data;
    },
    
    markAllAsRead: async () => {
        const headers = await getAuthHeader();
        const { data } = await apiFetch('/notifications/read-all', { 
            method: 'PUT',
            headers 
        });
        return data;
    }
};

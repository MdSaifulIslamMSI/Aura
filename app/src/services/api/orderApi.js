import { apiFetch } from '../apiBase';
import { getAuthHeader, createIdempotencyKey } from './apiUtils';

export const orderApi = {
    quoteOrder: async (payload) => {
        const headers = await getAuthHeader();
        const { data } = await apiFetch('/orders/quote', {
            method: 'POST',
            headers,
            body: JSON.stringify(payload),
        });
        return data;
    },
    createOrder: async (orderData) => {
        const headers = await getAuthHeader();
        const idempotencyKey = orderData?.idempotencyKey || createIdempotencyKey('order');
        const { data } = await apiFetch('/orders', {
            method: 'POST',
            headers: { ...headers, 'Idempotency-Key': idempotencyKey },
            body: JSON.stringify(orderData),
        });
        return data;
    },
    getMyOrders: async () => {
        const headers = await getAuthHeader();
        const { data } = await apiFetch('/orders/myorders', { headers });
        return data;
    },
    getOrderTimeline: async (orderId) => {
        const headers = await getAuthHeader();
        const { data } = await apiFetch(`/orders/${orderId}/timeline`, { headers });
        return data;
    },
    getCommandCenter: async (orderId) => {
        const headers = await getAuthHeader();
        const { data } = await apiFetch(`/orders/${orderId}/command-center`, { headers });
        return data;
    },
    requestRefund: async (orderId, payload = {}) => {
        const headers = await getAuthHeader();
        const { data } = await apiFetch(`/orders/${orderId}/command-center/refund`, {
            method: 'POST',
            headers,
            body: JSON.stringify(payload),
        });
        return data;
    },
    cancelOrder: async (orderId, payload = {}) => {
        const headers = await getAuthHeader();
        const { data } = await apiFetch(`/orders/${orderId}/cancel`, {
            method: 'POST',
            headers,
            body: JSON.stringify(payload),
        });
        return data;
    },
    cancelOrderAdmin: async (orderId, payload = {}) => {
        const headers = await getAuthHeader();
        const { data } = await apiFetch(`/orders/${orderId}/admin-cancel`, {
            method: 'POST',
            headers,
            body: JSON.stringify(payload),
        });
        return data;
    },
    requestReplacement: async (orderId, payload = {}) => {
        const headers = await getAuthHeader();
        const { data } = await apiFetch(`/orders/${orderId}/command-center/replace`, {
            method: 'POST',
            headers,
            body: JSON.stringify(payload),
        });
        return data;
    },
    sendSupportMessage: async (orderId, payload = {}) => {
        const headers = await getAuthHeader();
        const { data } = await apiFetch(`/orders/${orderId}/command-center/support`, {
            method: 'POST',
            headers,
            body: JSON.stringify(payload),
        });
        return data;
    },
    createWarrantyClaim: async (orderId, payload = {}) => {
        const headers = await getAuthHeader();
        const { data } = await apiFetch(`/orders/${orderId}/command-center/warranty`, {
            method: 'POST',
            headers,
            body: JSON.stringify(payload),
        });
        return data;
    },
    processRefundRequestAdmin: async (orderId, requestId, payload = {}) => {
        const headers = await getAuthHeader();
        const { data } = await apiFetch(`/orders/${orderId}/command-center/refund/${requestId}/admin`, {
            method: 'PATCH',
            headers,
            body: JSON.stringify(payload),
        });
        return data;
    },
    processReplacementRequestAdmin: async (orderId, requestId, payload = {}) => {
        const headers = await getAuthHeader();
        const { data } = await apiFetch(`/orders/${orderId}/command-center/replace/${requestId}/admin`, {
            method: 'PATCH',
            headers,
            body: JSON.stringify(payload),
        });
        return data;
    },
    replySupportAdmin: async (orderId, payload = {}) => {
        const headers = await getAuthHeader();
        const { data } = await apiFetch(`/orders/${orderId}/command-center/support/admin-reply`, {
            method: 'POST',
            headers,
            body: JSON.stringify(payload),
        });
        return data;
    },
    processWarrantyClaimAdmin: async (orderId, claimId, payload = {}) => {
        const headers = await getAuthHeader();
        const { data } = await apiFetch(`/orders/${orderId}/command-center/warranty/${claimId}/admin`, {
            method: 'PATCH',
            headers,
            body: JSON.stringify(payload),
        });
        return data;
    },
    getAllOrders: async () => {
        const headers = await getAuthHeader();
        const { data } = await apiFetch('/orders', { headers });
        return data;
    },
    updateOrderStatusAdmin: async (orderId, payload = {}) => {
        const headers = await getAuthHeader();
        const { data } = await apiFetch(`/orders/${orderId}/status`, {
            method: 'PATCH',
            headers,
            body: JSON.stringify(payload),
        });
        return data;
    }
};

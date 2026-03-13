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
    cancelOrder: async (orderId, payload = {}) => {
        const headers = await getAuthHeader();
        const { data } = await apiFetch(`/orders/${orderId}/cancel`, {
            method: 'POST',
            headers,
            body: JSON.stringify(payload),
        });
        return data;
    }
};

export const paymentApi = {
    createIntent: async (payload) => {
        const headers = await getAuthHeader();
        const idempotencyKey = payload?.idempotencyKey || createIdempotencyKey('intent');
        const { data } = await apiFetch('/payments/intents', {
            method: 'POST',
            headers: { ...headers, 'Idempotency-Key': idempotencyKey },
            body: JSON.stringify(payload),
        });
        return data;
    },
    confirmIntent: async (intentId, payload) => {
        const headers = await getAuthHeader();
        const idempotencyKey = payload?.idempotencyKey || createIdempotencyKey('confirm');
        const { data } = await apiFetch(`/payments/intents/${intentId}/confirm`, {
            method: 'POST',
            headers: { ...headers, 'Idempotency-Key': idempotencyKey },
            body: JSON.stringify(payload),
        });
        return data;
    },
    getMethods: async () => {
        const headers = await getAuthHeader();
        const { data } = await apiFetch('/payments/methods', { headers });
        return data;
    }
};

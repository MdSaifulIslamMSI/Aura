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
    completeChallenge: async (intentId, payload) => {
        const headers = await getAuthHeader();
        const { data } = await apiFetch(`/payments/intents/${intentId}/complete-challenge`, {
            method: 'POST',
            headers,
            body: JSON.stringify(payload),
        });
        return data;
    },
    createRefund: async (intentId, payload = {}) => {
        const headers = await getAuthHeader();
        const { data } = await apiFetch(`/payments/intents/${intentId}/refunds`, {
            method: 'POST',
            headers: {
                ...headers,
                'Idempotency-Key': payload?.idempotencyKey || createIdempotencyKey('refund'),
            },
            body: JSON.stringify(payload),
        });
        return data;
    },
    getMethods: async () => {
        const headers = await getAuthHeader();
        const { data } = await apiFetch('/payments/methods', { headers });
        return data;
    },
    saveMethod: async (payload) => {
        const headers = await getAuthHeader();
        const { data } = await apiFetch('/payments/methods', {
            method: 'POST',
            headers,
            body: JSON.stringify(payload),
        });
        return data;
    },
    setDefaultMethod: async (methodId) => {
        const headers = await getAuthHeader();
        const { data } = await apiFetch(`/payments/methods/${methodId}/default`, {
            method: 'PATCH',
            headers,
        });
        return data;
    },
    deleteMethod: async (methodId) => {
        const headers = await getAuthHeader();
        const { data } = await apiFetch(`/payments/methods/${methodId}`, {
            method: 'DELETE',
            headers,
        });
        return data;
    },
    getAdminPayments: async (params = {}) => {
        const headers = await getAuthHeader();
        const { data } = await apiFetch('/admin/payments', { headers, params });
        return data;
    },
    getRefundLedger: async (params = {}) => {
        const headers = await getAuthHeader();
        const { data } = await apiFetch('/admin/payments/refunds/ledger', { headers, params });
        return data;
    },
    updateRefundLedgerReference: async (orderId, requestId, payload = {}) => {
        const headers = await getAuthHeader();
        const { data } = await apiFetch(`/admin/payments/refunds/ledger/${orderId}/${requestId}/reference`, {
            method: 'PATCH',
            headers,
            body: JSON.stringify(payload),
        });
        return data;
    },
    getAdminPaymentById: async (intentId) => {
        const headers = await getAuthHeader();
        const { data } = await apiFetch(`/admin/payments/${intentId}`, { headers });
        return data;
    },
    captureAdminPayment: async (intentId, payload = {}) => {
        const headers = await getAuthHeader();
        const { data } = await apiFetch(`/admin/payments/${intentId}/capture`, {
            method: 'POST',
            headers: {
                ...headers,
                'Idempotency-Key': payload?.idempotencyKey || createIdempotencyKey('capture'),
            },
            body: JSON.stringify(payload),
        });
        return data;
    },
    retryAdminCapture: async (intentId, payload = {}) => {
        const headers = await getAuthHeader();
        const { data } = await apiFetch(`/admin/payments/${intentId}/retry-capture`, {
            method: 'POST',
            headers: {
                ...headers,
                'Idempotency-Key': payload?.idempotencyKey || createIdempotencyKey('retry-capture'),
            },
            body: JSON.stringify(payload),
        });
        return data;
    }
};

import { apiFetch } from '../apiBase';
import { getAuthHeader, createIdempotencyKey } from './apiUtils';

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
        const { data } = await apiFetch(`/payments/intents/${intentId}/challenge/complete`, {
            method: 'POST',
            headers,
            body: JSON.stringify(payload),
        });
        return data;
    },
    getIntent: async (intentId) => {
        const headers = await getAuthHeader();
        const { data } = await apiFetch(`/payments/intents/${intentId}`, { headers });
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
    getNetbankingBanks: async () => {
        const headers = await getAuthHeader();
        const { data } = await apiFetch('/payments/netbanking/banks', { headers });
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

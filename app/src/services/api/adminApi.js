import { apiFetch, buildServiceUrl } from '../apiBase';
import { getAuthHeader } from './apiUtils';

/**
 * CRITICAL: All admin API calls require authentication and admin role
 * Frontend ensures CSRF tokens are included for all state-changing requests
 */
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
    },
    listNotifications: async (params = {}) => {
        const headers = await getAuthHeader();
        const { data } = await apiFetch('/admin/notifications', { headers, params });
        return data;
    },
    getNotificationSummary: async () => {
        const headers = await getAuthHeader();
        const { data } = await apiFetch('/admin/notifications/summary', { headers });
        return data;
    },
    markNotificationRead: async (notificationId, read = true) => {
        const headers = await getAuthHeader();
        const { data } = await apiFetch(`/admin/notifications/${notificationId}/read`, {
            method: 'PATCH',
            headers,
            body: JSON.stringify({ read: Boolean(read) }),
        });
        return data;
    },
    markAllNotificationsRead: async (filters = {}) => {
        const headers = await getAuthHeader();
        const { data } = await apiFetch('/admin/notifications/read-all', {
            method: 'PATCH',
            headers,
            body: JSON.stringify(filters),
        });
        return data;
    },
    getAnalyticsTimeSeries: async (params = {}) => {
        const headers = await getAuthHeader();
        const { data } = await apiFetch('/admin/analytics/timeseries', { headers, params });
        return data;
    },
    getAnalyticsAnomalies: async (params = {}) => {
        const headers = await getAuthHeader();
        const { data } = await apiFetch('/admin/analytics/anomalies', { headers, params });
        return data;
    },
    getBiConfig: async () => {
        const headers = await getAuthHeader();
        const { data } = await apiFetch('/admin/analytics/bi-config', { headers });
        return data;
    },
    exportAnalyticsCsv: async (params = {}) => {
        const headers = await getAuthHeader();
        const { response } = await apiFetch('/admin/analytics/export', {
            headers,
            params,
            throwOnHttpError: true,
        });
        const blob = await response.blob();
        const disposition = response.headers.get('content-disposition') || '';
        const match = disposition.match(/filename=\"?([^\";]+)\"?/i);
        const filename = match?.[1] || `admin_export_${Date.now()}.csv`;
        const rowCount = Number(response.headers.get('x-admin-export-row-count') || 0);
        return { blob, filename, rowCount };
    },
    getSystemHealth: async () => {
        const headers = await getAuthHeader();
        const response = await fetch(buildServiceUrl('/health'), {
            headers: { ...headers, Accept: 'application/json' },
        });
        if (!response.ok) return { status: 'down' }; // Graceful fallback
        return response.json();
    },
    getOpsReadiness: async () => {
        const headers = await getAuthHeader();
        const { data } = await apiFetch('/admin/ops/readiness', { headers });
        return data;
    },
    runOpsSmoke: async () => {
        const headers = await getAuthHeader();
        const { data } = await apiFetch('/admin/ops/smoke', {
            method: 'POST',
            headers,
        });
        return data;
    },
    getClientDiagnostics: async (params = {}) => {
        const headers = await getAuthHeader();
        const { data } = await apiFetch('/admin/ops/client-diagnostics', { headers, params });
        return data;
    },
    dismissUserWarning: async (userId) => {
        const headers = await getAuthHeader();
        const { data } = await apiFetch(`/admin/users/${userId}/dismiss-warning`, {
            method: 'POST',
            headers,
        });
        return data;
    },
    reactivateUser: async (userId, payload = {}) => {
        const headers = await getAuthHeader();
        const { data } = await apiFetch(`/admin/users/${userId}/reactivate`, {
            method: 'POST',
            headers,
            body: JSON.stringify(payload),
        });
        return data;
    },
    deleteUser: async (userId, payload = {}) => {
        const headers = await getAuthHeader();
        const { data } = await apiFetch(`/admin/users/${userId}/delete`, {
            method: 'POST',
            headers,
            body: JSON.stringify(payload),
        });
        return data;
    },
    getProductById: async (id) => {
        const headers = await getAuthHeader();
        const { data } = await apiFetch(`/admin/products/${encodeURIComponent(String(id))}?_t=${Date.now()}`, { headers });
        return data;
    },
    getProductLogs: async (id) => {
        const headers = await getAuthHeader();
        const { data } = await apiFetch(`/admin/products/${encodeURIComponent(String(id))}/logs?_t=${Date.now()}`, { headers });
        return data;
    },
    createProduct: async (payload) => {
        const headers = await getAuthHeader();
        const { data } = await apiFetch('/admin/products', {
            method: 'POST',
            headers,
            body: JSON.stringify(payload),
        });
        return data;
    },
    updateProductCore: async (id, payload) => {
        const headers = await getAuthHeader();
        const { data } = await apiFetch(`/admin/products/${encodeURIComponent(String(id))}/core`, {
            method: 'PATCH',
            headers,
            body: JSON.stringify(payload),
        });
        return data;
    },
    updateProductPricing: async (id, payload) => {
        const headers = await getAuthHeader();
        const { data } = await apiFetch(`/admin/products/${encodeURIComponent(String(id))}/pricing`, {
            method: 'PATCH',
            headers,
            body: JSON.stringify(payload),
        });
        return data;
    },
    deleteProduct: async (id, payload = {}) => {
        const headers = await getAuthHeader();
        const { data } = await apiFetch(`/admin/products/${encodeURIComponent(String(id))}`, {
            method: 'DELETE',
            headers,
            body: JSON.stringify(payload),
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

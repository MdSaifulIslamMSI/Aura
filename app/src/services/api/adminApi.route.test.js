// AUTO-GENERATED route-contract suite for adminApi.js — do not edit by hand.
// Regenerate with: node scripts/generate-api-client-tests.cjs adminApi.js
import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('../apiBase', () => ({
    apiFetch: vi.fn(async () => ({ data: {} })),
    buildApiUrl: vi.fn((p) => `/api${p}`),
    buildServiceUrl: vi.fn((p) => `http://service.local${p}`),
    API_BASE_URL: '/api',
    SERVICE_BASE_URL: 'http://service.local',
    parseJsonSafely: vi.fn(async () => ({})),
    createResponseError: vi.fn(async (message) => new Error(message)),
}));
vi.mock('./apiUtils', () => ({
    getAuthHeader: vi.fn(async () => ({ Authorization: 'Bearer test' })),
    createIdempotencyKey: vi.fn((prefix) => `${prefix}-test`),
    runWhenIdle: vi.fn((callback) => { callback(); }),
    parseApiError: vi.fn(async (message) => message),
    PROFILE_CACHE_TTL_MS: 15000,
    PRODUCT_DETAIL_CACHE_TTL_MS: 30000,
    AUTH_TOKEN_TIMEOUT_MS: 5000,
}));

import { apiFetch } from '../apiBase';
import { adminApi } from './adminApi';

// Symbol-safe passthrough args: template-literal conversion, property
// access, and calls all degrade to deterministic placeholder strings.
const anyArgs = new Proxy(function placeholder() {}, {
    get: (target, key) => {
        if (typeof key === 'symbol') return () => String(key.description || '');
        if (key === 'toString' || key === 'valueOf') return () => key;
        return String(key);
    },
    apply: () => 'arg',
});

beforeEach(() => {
    apiFetch.mockClear();
});

describe('adminApi route contract', () => {
    it("getAnalyticsOverview calls GET /admin/analytics/overview", async () => {
        await adminApi.getAnalyticsOverview(anyArgs).catch(() => {});
        expect(apiFetch).toHaveBeenCalled();
        const [reqPath, options = {}] = apiFetch.mock.calls[apiFetch.mock.calls.length - 1];
        expect(String(options.method || 'GET')).toBe('GET');
        expect(String(reqPath)).toBe("/admin/analytics/overview");
        expect(options.headers && options.headers.Authorization).toBe('Bearer test');
    });

    it("listUsers calls GET /admin/users", async () => {
        await adminApi.listUsers(anyArgs).catch(() => {});
        expect(apiFetch).toHaveBeenCalled();
        const [reqPath, options = {}] = apiFetch.mock.calls[apiFetch.mock.calls.length - 1];
        expect(String(options.method || 'GET')).toBe('GET');
        expect(String(reqPath)).toBe("/admin/users");
        expect(options.headers && options.headers.Authorization).toBe('Bearer test');
    });

    it("getUserDetails calls GET /admin/users/${userId}", async () => {
        await adminApi.getUserDetails(anyArgs).catch(() => {});
        expect(apiFetch).toHaveBeenCalled();
        const [reqPath, options = {}] = apiFetch.mock.calls[apiFetch.mock.calls.length - 1];
        expect(String(options.method || 'GET')).toBe('GET');
        expect(String(reqPath)).toContain("/admin/users/");
        expect(options.headers && options.headers.Authorization).toBe('Bearer test');
    });

    it("warnUser calls POST /admin/users/${userId}/warn", async () => {
        await adminApi.warnUser(anyArgs).catch(() => {});
        expect(apiFetch).toHaveBeenCalled();
        const [reqPath, options = {}] = apiFetch.mock.calls[apiFetch.mock.calls.length - 1];
        expect(String(options.method || 'GET')).toBe('POST');
        expect(String(reqPath)).toContain("/admin/users/");
        expect(String(reqPath)).toContain("/warn");
        expect(options.headers && options.headers.Authorization).toBe('Bearer test');
    });

    it("suspendUser calls POST /admin/users/${userId}/suspend", async () => {
        await adminApi.suspendUser(anyArgs).catch(() => {});
        expect(apiFetch).toHaveBeenCalled();
        const [reqPath, options = {}] = apiFetch.mock.calls[apiFetch.mock.calls.length - 1];
        expect(String(options.method || 'GET')).toBe('POST');
        expect(String(reqPath)).toContain("/admin/users/");
        expect(String(reqPath)).toContain("/suspend");
        expect(options.headers && options.headers.Authorization).toBe('Bearer test');
    });

    it("getProducts calls GET /admin/products", async () => {
        await adminApi.getProducts(anyArgs).catch(() => {});
        expect(apiFetch).toHaveBeenCalled();
        const [reqPath, options = {}] = apiFetch.mock.calls[apiFetch.mock.calls.length - 1];
        expect(String(options.method || 'GET')).toBe('GET');
        expect(String(reqPath)).toBe("/admin/products");
        expect(options.headers && options.headers.Authorization).toBe('Bearer test');
    });

    it("listNotifications calls GET /admin/notifications", async () => {
        await adminApi.listNotifications(anyArgs).catch(() => {});
        expect(apiFetch).toHaveBeenCalled();
        const [reqPath, options = {}] = apiFetch.mock.calls[apiFetch.mock.calls.length - 1];
        expect(String(options.method || 'GET')).toBe('GET');
        expect(String(reqPath)).toBe("/admin/notifications");
        expect(options.headers && options.headers.Authorization).toBe('Bearer test');
    });

    it("getNotificationSummary calls GET /admin/notifications/summary", async () => {
        await adminApi.getNotificationSummary(anyArgs).catch(() => {});
        expect(apiFetch).toHaveBeenCalled();
        const [reqPath, options = {}] = apiFetch.mock.calls[apiFetch.mock.calls.length - 1];
        expect(String(options.method || 'GET')).toBe('GET');
        expect(String(reqPath)).toBe("/admin/notifications/summary");
        expect(options.headers && options.headers.Authorization).toBe('Bearer test');
    });

    it("getEmailOpsSummary calls GET /admin/email-ops/summary", async () => {
        await adminApi.getEmailOpsSummary(anyArgs).catch(() => {});
        expect(apiFetch).toHaveBeenCalled();
        const [reqPath, options = {}] = apiFetch.mock.calls[apiFetch.mock.calls.length - 1];
        expect(String(options.method || 'GET')).toBe('GET');
        expect(String(reqPath)).toBe("/admin/email-ops/summary");
        expect(options.headers && options.headers.Authorization).toBe('Bearer test');
    });

    it("listEmailDeliveries calls GET /admin/email-ops/deliveries", async () => {
        await adminApi.listEmailDeliveries(anyArgs).catch(() => {});
        expect(apiFetch).toHaveBeenCalled();
        const [reqPath, options = {}] = apiFetch.mock.calls[apiFetch.mock.calls.length - 1];
        expect(String(options.method || 'GET')).toBe('GET');
        expect(String(reqPath)).toBe("/admin/email-ops/deliveries");
        expect(options.headers && options.headers.Authorization).toBe('Bearer test');
    });

    it("listEmailQueue calls GET /admin/email-ops/order-queue", async () => {
        await adminApi.listEmailQueue(anyArgs).catch(() => {});
        expect(apiFetch).toHaveBeenCalled();
        const [reqPath, options = {}] = apiFetch.mock.calls[apiFetch.mock.calls.length - 1];
        expect(String(options.method || 'GET')).toBe('GET');
        expect(String(reqPath)).toBe("/admin/email-ops/order-queue");
        expect(options.headers && options.headers.Authorization).toBe('Bearer test');
    });

    it("getEmailQueueItem calls GET /admin/email-ops/order-queue/${notificationId}", async () => {
        await adminApi.getEmailQueueItem(anyArgs).catch(() => {});
        expect(apiFetch).toHaveBeenCalled();
        const [reqPath, options = {}] = apiFetch.mock.calls[apiFetch.mock.calls.length - 1];
        expect(String(options.method || 'GET')).toBe('GET');
        expect(String(reqPath)).toContain("/admin/email-ops/order-queue/");
        expect(options.headers && options.headers.Authorization).toBe('Bearer test');
    });

    it("retryEmailQueueItem calls POST /admin/email-ops/order-queue/${notificationId}/retry", async () => {
        await adminApi.retryEmailQueueItem(anyArgs).catch(() => {});
        expect(apiFetch).toHaveBeenCalled();
        const [reqPath, options = {}] = apiFetch.mock.calls[apiFetch.mock.calls.length - 1];
        expect(String(options.method || 'GET')).toBe('POST');
        expect(String(reqPath)).toContain("/admin/email-ops/order-queue/");
        expect(String(reqPath)).toContain("/retry");
        expect(options.headers && options.headers.Authorization).toBe('Bearer test');
    });

    it("sendEmailOpsTest calls POST /admin/email-ops/test-send", async () => {
        await adminApi.sendEmailOpsTest(anyArgs).catch(() => {});
        expect(apiFetch).toHaveBeenCalled();
        const [reqPath, options = {}] = apiFetch.mock.calls[apiFetch.mock.calls.length - 1];
        expect(String(options.method || 'GET')).toBe('POST');
        expect(String(reqPath)).toBe("/admin/email-ops/test-send");
        expect(options.headers && options.headers.Authorization).toBe('Bearer test');
    });

    it("markNotificationRead calls PATCH /admin/notifications/${notificationId}/read", async () => {
        await adminApi.markNotificationRead(anyArgs).catch(() => {});
        expect(apiFetch).toHaveBeenCalled();
        const [reqPath, options = {}] = apiFetch.mock.calls[apiFetch.mock.calls.length - 1];
        expect(String(options.method || 'GET')).toBe('PATCH');
        expect(String(reqPath)).toContain("/admin/notifications/");
        expect(String(reqPath)).toContain("/read");
        expect(options.headers && options.headers.Authorization).toBe('Bearer test');
    });

    it("markAllNotificationsRead calls PATCH /admin/notifications/read-all", async () => {
        await adminApi.markAllNotificationsRead(anyArgs).catch(() => {});
        expect(apiFetch).toHaveBeenCalled();
        const [reqPath, options = {}] = apiFetch.mock.calls[apiFetch.mock.calls.length - 1];
        expect(String(options.method || 'GET')).toBe('PATCH');
        expect(String(reqPath)).toBe("/admin/notifications/read-all");
        expect(options.headers && options.headers.Authorization).toBe('Bearer test');
    });

    it("getAnalyticsTimeSeries calls GET /admin/analytics/timeseries", async () => {
        await adminApi.getAnalyticsTimeSeries(anyArgs).catch(() => {});
        expect(apiFetch).toHaveBeenCalled();
        const [reqPath, options = {}] = apiFetch.mock.calls[apiFetch.mock.calls.length - 1];
        expect(String(options.method || 'GET')).toBe('GET');
        expect(String(reqPath)).toBe("/admin/analytics/timeseries");
        expect(options.headers && options.headers.Authorization).toBe('Bearer test');
    });

    it("getAnalyticsAnomalies calls GET /admin/analytics/anomalies", async () => {
        await adminApi.getAnalyticsAnomalies(anyArgs).catch(() => {});
        expect(apiFetch).toHaveBeenCalled();
        const [reqPath, options = {}] = apiFetch.mock.calls[apiFetch.mock.calls.length - 1];
        expect(String(options.method || 'GET')).toBe('GET');
        expect(String(reqPath)).toBe("/admin/analytics/anomalies");
        expect(options.headers && options.headers.Authorization).toBe('Bearer test');
    });

    it("getBiConfig calls GET /admin/analytics/bi-config", async () => {
        await adminApi.getBiConfig(anyArgs).catch(() => {});
        expect(apiFetch).toHaveBeenCalled();
        const [reqPath, options = {}] = apiFetch.mock.calls[apiFetch.mock.calls.length - 1];
        expect(String(options.method || 'GET')).toBe('GET');
        expect(String(reqPath)).toBe("/admin/analytics/bi-config");
        expect(options.headers && options.headers.Authorization).toBe('Bearer test');
    });

    it("exportAnalyticsCsv calls GET /admin/analytics/export", async () => {
        await adminApi.exportAnalyticsCsv(anyArgs).catch(() => {});
        expect(apiFetch).toHaveBeenCalled();
        const [reqPath, options = {}] = apiFetch.mock.calls[apiFetch.mock.calls.length - 1];
        expect(String(options.method || 'GET')).toBe('GET');
        expect(String(reqPath)).toBe("/admin/analytics/export");
        expect(options.headers && options.headers.Authorization).toBe('Bearer test');
    });

    it("getOpsReadiness calls GET /admin/ops/readiness", async () => {
        await adminApi.getOpsReadiness(anyArgs).catch(() => {});
        expect(apiFetch).toHaveBeenCalled();
        const [reqPath, options = {}] = apiFetch.mock.calls[apiFetch.mock.calls.length - 1];
        expect(String(options.method || 'GET')).toBe('GET');
        expect(String(reqPath)).toBe("/admin/ops/readiness");
        expect(options.headers && options.headers.Authorization).toBe('Bearer test');
    });

    it("getAwsControl calls GET /admin/ops/aws-control", async () => {
        await adminApi.getAwsControl(anyArgs).catch(() => {});
        expect(apiFetch).toHaveBeenCalled();
        const [reqPath, options = {}] = apiFetch.mock.calls[apiFetch.mock.calls.length - 1];
        expect(String(options.method || 'GET')).toBe('GET');
        expect(String(reqPath)).toBe("/admin/ops/aws-control");
        expect(options.headers && options.headers.Authorization).toBe('Bearer test');
    });

    it("runAwsControlAction calls POST /admin/ops/aws-control/actions", async () => {
        await adminApi.runAwsControlAction(anyArgs).catch(() => {});
        expect(apiFetch).toHaveBeenCalled();
        const [reqPath, options = {}] = apiFetch.mock.calls[apiFetch.mock.calls.length - 1];
        expect(String(options.method || 'GET')).toBe('POST');
        expect(String(reqPath)).toBe("/admin/ops/aws-control/actions");
        expect(options.headers && options.headers.Authorization).toBe('Bearer test');
    });

    it("runOpsSmoke calls POST /admin/ops/smoke", async () => {
        await adminApi.runOpsSmoke(anyArgs).catch(() => {});
        expect(apiFetch).toHaveBeenCalled();
        const [reqPath, options = {}] = apiFetch.mock.calls[apiFetch.mock.calls.length - 1];
        expect(String(options.method || 'GET')).toBe('POST');
        expect(String(reqPath)).toBe("/admin/ops/smoke");
        expect(options.headers && options.headers.Authorization).toBe('Bearer test');
    });

    it("getClientDiagnostics calls GET /admin/ops/client-diagnostics", async () => {
        await adminApi.getClientDiagnostics(anyArgs).catch(() => {});
        expect(apiFetch).toHaveBeenCalled();
        const [reqPath, options = {}] = apiFetch.mock.calls[apiFetch.mock.calls.length - 1];
        expect(String(options.method || 'GET')).toBe('GET');
        expect(String(reqPath)).toBe("/admin/ops/client-diagnostics");
        expect(options.headers && options.headers.Authorization).toBe('Bearer test');
    });

    it("dismissUserWarning calls POST /admin/users/${userId}/dismiss-warning", async () => {
        await adminApi.dismissUserWarning(anyArgs).catch(() => {});
        expect(apiFetch).toHaveBeenCalled();
        const [reqPath, options = {}] = apiFetch.mock.calls[apiFetch.mock.calls.length - 1];
        expect(String(options.method || 'GET')).toBe('POST');
        expect(String(reqPath)).toContain("/admin/users/");
        expect(String(reqPath)).toContain("/dismiss-warning");
        expect(options.headers && options.headers.Authorization).toBe('Bearer test');
    });

    it("dismissWarning calls POST /admin/users/${userId}/dismiss-warning", async () => {
        await adminApi.dismissWarning(anyArgs).catch(() => {});
        expect(apiFetch).toHaveBeenCalled();
        const [reqPath, options = {}] = apiFetch.mock.calls[apiFetch.mock.calls.length - 1];
        expect(String(options.method || 'GET')).toBe('POST');
        expect(String(reqPath)).toContain("/admin/users/");
        expect(String(reqPath)).toContain("/dismiss-warning");
        expect(options.headers && options.headers.Authorization).toBe('Bearer test');
    });

    it("reactivateUser calls POST /admin/users/${userId}/reactivate", async () => {
        await adminApi.reactivateUser(anyArgs).catch(() => {});
        expect(apiFetch).toHaveBeenCalled();
        const [reqPath, options = {}] = apiFetch.mock.calls[apiFetch.mock.calls.length - 1];
        expect(String(options.method || 'GET')).toBe('POST');
        expect(String(reqPath)).toContain("/admin/users/");
        expect(String(reqPath)).toContain("/reactivate");
        expect(options.headers && options.headers.Authorization).toBe('Bearer test');
    });

    it("deleteUser calls POST /admin/users/${userId}/delete", async () => {
        await adminApi.deleteUser(anyArgs).catch(() => {});
        expect(apiFetch).toHaveBeenCalled();
        const [reqPath, options = {}] = apiFetch.mock.calls[apiFetch.mock.calls.length - 1];
        expect(String(options.method || 'GET')).toBe('POST');
        expect(String(reqPath)).toContain("/admin/users/");
        expect(String(reqPath)).toContain("/delete");
        expect(options.headers && options.headers.Authorization).toBe('Bearer test');
    });

    it("getProductById calls GET /admin/products/${encodeURIComponent(String(id))}?_t=${Date.now()}", async () => {
        await adminApi.getProductById(anyArgs).catch(() => {});
        expect(apiFetch).toHaveBeenCalled();
        const [reqPath, options = {}] = apiFetch.mock.calls[apiFetch.mock.calls.length - 1];
        expect(String(options.method || 'GET')).toBe('GET');
        expect(String(reqPath)).toContain("/admin/products/");
        expect(String(reqPath)).toContain("?_t=");
        expect(options.headers && options.headers.Authorization).toBe('Bearer test');
    });

    it("getProductLogs calls GET /admin/products/${encodeURIComponent(String(id))}/logs?_t=${Date.now()}", async () => {
        await adminApi.getProductLogs(anyArgs).catch(() => {});
        expect(apiFetch).toHaveBeenCalled();
        const [reqPath, options = {}] = apiFetch.mock.calls[apiFetch.mock.calls.length - 1];
        expect(String(options.method || 'GET')).toBe('GET');
        expect(String(reqPath)).toContain("/admin/products/");
        expect(String(reqPath)).toContain("/logs?_t=");
        expect(options.headers && options.headers.Authorization).toBe('Bearer test');
    });

    it("createProduct calls POST /admin/products", async () => {
        await adminApi.createProduct(anyArgs).catch(() => {});
        expect(apiFetch).toHaveBeenCalled();
        const [reqPath, options = {}] = apiFetch.mock.calls[apiFetch.mock.calls.length - 1];
        expect(String(options.method || 'GET')).toBe('POST');
        expect(String(reqPath)).toBe("/admin/products");
        expect(options.headers && options.headers.Authorization).toBe('Bearer test');
    });

    it("updateProductCore calls PATCH /admin/products/${encodeURIComponent(String(id))}/core", async () => {
        await adminApi.updateProductCore(anyArgs).catch(() => {});
        expect(apiFetch).toHaveBeenCalled();
        const [reqPath, options = {}] = apiFetch.mock.calls[apiFetch.mock.calls.length - 1];
        expect(String(options.method || 'GET')).toBe('PATCH');
        expect(String(reqPath)).toContain("/admin/products/");
        expect(String(reqPath)).toContain("/core");
        expect(options.headers && options.headers.Authorization).toBe('Bearer test');
    });

    it("updateProductPricing calls PATCH /admin/products/${encodeURIComponent(String(id))}/pricing", async () => {
        await adminApi.updateProductPricing(anyArgs).catch(() => {});
        expect(apiFetch).toHaveBeenCalled();
        const [reqPath, options = {}] = apiFetch.mock.calls[apiFetch.mock.calls.length - 1];
        expect(String(options.method || 'GET')).toBe('PATCH');
        expect(String(reqPath)).toContain("/admin/products/");
        expect(String(reqPath)).toContain("/pricing");
        expect(options.headers && options.headers.Authorization).toBe('Bearer test');
    });

    it("deleteProduct calls DELETE /admin/products/${encodeURIComponent(String(id))}", async () => {
        await adminApi.deleteProduct(anyArgs).catch(() => {});
        expect(apiFetch).toHaveBeenCalled();
        const [reqPath, options = {}] = apiFetch.mock.calls[apiFetch.mock.calls.length - 1];
        expect(String(options.method || 'GET')).toBe('DELETE');
        expect(String(reqPath)).toContain("/admin/products/");
        expect(options.headers && options.headers.Authorization).toBe('Bearer test');
    });

    it("getAdminPayments calls GET /admin/payments", async () => {
        await adminApi.getAdminPayments(anyArgs).catch(() => {});
        expect(apiFetch).toHaveBeenCalled();
        const [reqPath, options = {}] = apiFetch.mock.calls[apiFetch.mock.calls.length - 1];
        expect(String(options.method || 'GET')).toBe('GET');
        expect(String(reqPath)).toBe("/admin/payments");
        expect(options.headers && options.headers.Authorization).toBe('Bearer test');
    });

    it("getRefundLedger calls GET /admin/payments/refunds/ledger", async () => {
        await adminApi.getRefundLedger(anyArgs).catch(() => {});
        expect(apiFetch).toHaveBeenCalled();
        const [reqPath, options = {}] = apiFetch.mock.calls[apiFetch.mock.calls.length - 1];
        expect(String(options.method || 'GET')).toBe('GET');
        expect(String(reqPath)).toBe("/admin/payments/refunds/ledger");
        expect(options.headers && options.headers.Authorization).toBe('Bearer test');
    });

    it("updateRefundLedgerReference calls PATCH /admin/payments/refunds/ledger/${orderId}/${requestId}/reference", async () => {
        await adminApi.updateRefundLedgerReference(anyArgs).catch(() => {});
        expect(apiFetch).toHaveBeenCalled();
        const [reqPath, options = {}] = apiFetch.mock.calls[apiFetch.mock.calls.length - 1];
        expect(String(options.method || 'GET')).toBe('PATCH');
        expect(String(reqPath)).toContain("/admin/payments/refunds/ledger/");
        expect(String(reqPath)).toContain("/");
        expect(String(reqPath)).toContain("/reference");
        expect(options.headers && options.headers.Authorization).toBe('Bearer test');
    });

    it("getAdminPaymentById calls GET /admin/payments/${intentId}", async () => {
        await adminApi.getAdminPaymentById(anyArgs).catch(() => {});
        expect(apiFetch).toHaveBeenCalled();
        const [reqPath, options = {}] = apiFetch.mock.calls[apiFetch.mock.calls.length - 1];
        expect(String(options.method || 'GET')).toBe('GET');
        expect(String(reqPath)).toContain("/admin/payments/");
        expect(options.headers && options.headers.Authorization).toBe('Bearer test');
    });

    it("captureAdminPayment calls POST /admin/payments/${intentId}/capture", async () => {
        await adminApi.captureAdminPayment(anyArgs).catch(() => {});
        expect(apiFetch).toHaveBeenCalled();
        const [reqPath, options = {}] = apiFetch.mock.calls[apiFetch.mock.calls.length - 1];
        expect(String(options.method || 'GET')).toBe('POST');
        expect(String(reqPath)).toContain("/admin/payments/");
        expect(String(reqPath)).toContain("/capture");
        expect(options.headers && options.headers.Authorization).toBe('Bearer test');
    });

    it("retryAdminCapture calls POST /admin/payments/${intentId}/retry-capture", async () => {
        await adminApi.retryAdminCapture(anyArgs).catch(() => {});
        expect(apiFetch).toHaveBeenCalled();
        const [reqPath, options = {}] = apiFetch.mock.calls[apiFetch.mock.calls.length - 1];
        expect(String(options.method || 'GET')).toBe('POST');
        expect(String(reqPath)).toContain("/admin/payments/");
        expect(String(reqPath)).toContain("/retry-capture");
        expect(options.headers && options.headers.Authorization).toBe('Bearer test');
    });

});

// AUTO-GENERATED route-contract suite for orderApi.js — do not edit by hand.
// Regenerate with: node scripts/generate-api-client-tests.cjs orderApi.js
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
import { orderApi } from './orderApi';

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

describe('orderApi route contract', () => {
    it("getCheckoutConfig calls GET /checkout/config", async () => {
        await orderApi.getCheckoutConfig(anyArgs).catch(() => {});
        expect(apiFetch).toHaveBeenCalled();
        const [reqPath, options = {}] = apiFetch.mock.calls[apiFetch.mock.calls.length - 1];
        expect(String(options.method || 'GET')).toBe('GET');
        expect(String(reqPath)).toBe("/checkout/config");
        expect(options.headers && options.headers.Authorization).toBe('Bearer test');
    });

    it("quoteOrder calls POST /orders/quote", async () => {
        await orderApi.quoteOrder(anyArgs).catch(() => {});
        expect(apiFetch).toHaveBeenCalled();
        const [reqPath, options = {}] = apiFetch.mock.calls[apiFetch.mock.calls.length - 1];
        expect(String(options.method || 'GET')).toBe('POST');
        expect(String(reqPath)).toBe("/orders/quote");
        expect(options.headers && options.headers.Authorization).toBe('Bearer test');
    });

    it("createOrder calls POST /orders", async () => {
        await orderApi.createOrder(anyArgs).catch(() => {});
        expect(apiFetch).toHaveBeenCalled();
        const [reqPath, options = {}] = apiFetch.mock.calls[apiFetch.mock.calls.length - 1];
        expect(String(options.method || 'GET')).toBe('POST');
        expect(String(reqPath)).toBe("/orders");
        expect(options.headers && options.headers.Authorization).toBe('Bearer test');
    });

    it("getMyOrders calls GET /orders/myorders${buildQueryString({\n            limit: ORDER_LIST_PAGE_SIZE,\n            ...params,\n        })}", async () => {
        await orderApi.getMyOrders(anyArgs).catch(() => {});
        expect(apiFetch).toHaveBeenCalled();
        const [reqPath, options = {}] = apiFetch.mock.calls[apiFetch.mock.calls.length - 1];
        expect(String(options.method || 'GET')).toBe('GET');
        expect(String(reqPath)).toContain("/orders/myorders");
        expect(options.headers && options.headers.Authorization).toBe('Bearer test');
    });

    it("getOrderTimeline calls GET /orders/${orderId}/timeline", async () => {
        await orderApi.getOrderTimeline(anyArgs).catch(() => {});
        expect(apiFetch).toHaveBeenCalled();
        const [reqPath, options = {}] = apiFetch.mock.calls[apiFetch.mock.calls.length - 1];
        expect(String(options.method || 'GET')).toBe('GET');
        expect(String(reqPath)).toContain("/orders/");
        expect(String(reqPath)).toContain("/timeline");
        expect(options.headers && options.headers.Authorization).toBe('Bearer test');
    });

    it("getCommandCenter calls GET /orders/${orderId}/command-center", async () => {
        await orderApi.getCommandCenter(anyArgs).catch(() => {});
        expect(apiFetch).toHaveBeenCalled();
        const [reqPath, options = {}] = apiFetch.mock.calls[apiFetch.mock.calls.length - 1];
        expect(String(options.method || 'GET')).toBe('GET');
        expect(String(reqPath)).toContain("/orders/");
        expect(String(reqPath)).toContain("/command-center");
        expect(options.headers && options.headers.Authorization).toBe('Bearer test');
    });

    it("getReceipt calls GET /orders/${orderId}/receipt", async () => {
        await orderApi.getReceipt(anyArgs).catch(() => {});
        expect(apiFetch).toHaveBeenCalled();
        const [reqPath, options = {}] = apiFetch.mock.calls[apiFetch.mock.calls.length - 1];
        expect(String(options.method || 'GET')).toBe('GET');
        expect(String(reqPath)).toContain("/orders/");
        expect(String(reqPath)).toContain("/receipt");
        expect(options.headers && options.headers.Authorization).toBe('Bearer test');
    });

    it("buyAgain calls POST /orders/${orderId}/buy-again", async () => {
        await orderApi.buyAgain(anyArgs).catch(() => {});
        expect(apiFetch).toHaveBeenCalled();
        const [reqPath, options = {}] = apiFetch.mock.calls[apiFetch.mock.calls.length - 1];
        expect(String(options.method || 'GET')).toBe('POST');
        expect(String(reqPath)).toContain("/orders/");
        expect(String(reqPath)).toContain("/buy-again");
        expect(options.headers && options.headers.Authorization).toBe('Bearer test');
    });

    it("requestRefund calls POST /orders/${orderId}/command-center/refund", async () => {
        await orderApi.requestRefund(anyArgs).catch(() => {});
        expect(apiFetch).toHaveBeenCalled();
        const [reqPath, options = {}] = apiFetch.mock.calls[apiFetch.mock.calls.length - 1];
        expect(String(options.method || 'GET')).toBe('POST');
        expect(String(reqPath)).toContain("/orders/");
        expect(String(reqPath)).toContain("/command-center/refund");
        expect(options.headers && options.headers.Authorization).toBe('Bearer test');
    });

    it("cancelOrder calls POST /orders/${orderId}/cancel", async () => {
        await orderApi.cancelOrder(anyArgs).catch(() => {});
        expect(apiFetch).toHaveBeenCalled();
        const [reqPath, options = {}] = apiFetch.mock.calls[apiFetch.mock.calls.length - 1];
        expect(String(options.method || 'GET')).toBe('POST');
        expect(String(reqPath)).toContain("/orders/");
        expect(String(reqPath)).toContain("/cancel");
        expect(options.headers && options.headers.Authorization).toBe('Bearer test');
    });

    it("cancelOrderAdmin calls POST /orders/${orderId}/admin-cancel", async () => {
        await orderApi.cancelOrderAdmin(anyArgs).catch(() => {});
        expect(apiFetch).toHaveBeenCalled();
        const [reqPath, options = {}] = apiFetch.mock.calls[apiFetch.mock.calls.length - 1];
        expect(String(options.method || 'GET')).toBe('POST');
        expect(String(reqPath)).toContain("/orders/");
        expect(String(reqPath)).toContain("/admin-cancel");
        expect(options.headers && options.headers.Authorization).toBe('Bearer test');
    });

    it("requestReplacement calls POST /orders/${orderId}/command-center/replace", async () => {
        await orderApi.requestReplacement(anyArgs).catch(() => {});
        expect(apiFetch).toHaveBeenCalled();
        const [reqPath, options = {}] = apiFetch.mock.calls[apiFetch.mock.calls.length - 1];
        expect(String(options.method || 'GET')).toBe('POST');
        expect(String(reqPath)).toContain("/orders/");
        expect(String(reqPath)).toContain("/command-center/replace");
        expect(options.headers && options.headers.Authorization).toBe('Bearer test');
    });

    it("sendSupportMessage calls POST /orders/${orderId}/command-center/support", async () => {
        await orderApi.sendSupportMessage(anyArgs).catch(() => {});
        expect(apiFetch).toHaveBeenCalled();
        const [reqPath, options = {}] = apiFetch.mock.calls[apiFetch.mock.calls.length - 1];
        expect(String(options.method || 'GET')).toBe('POST');
        expect(String(reqPath)).toContain("/orders/");
        expect(String(reqPath)).toContain("/command-center/support");
        expect(options.headers && options.headers.Authorization).toBe('Bearer test');
    });

    it("createWarrantyClaim calls POST /orders/${orderId}/command-center/warranty", async () => {
        await orderApi.createWarrantyClaim(anyArgs).catch(() => {});
        expect(apiFetch).toHaveBeenCalled();
        const [reqPath, options = {}] = apiFetch.mock.calls[apiFetch.mock.calls.length - 1];
        expect(String(options.method || 'GET')).toBe('POST');
        expect(String(reqPath)).toContain("/orders/");
        expect(String(reqPath)).toContain("/command-center/warranty");
        expect(options.headers && options.headers.Authorization).toBe('Bearer test');
    });

    it("processRefundRequestAdmin calls PATCH /orders/${orderId}/command-center/refund/${requestId}/admin", async () => {
        await orderApi.processRefundRequestAdmin(anyArgs).catch(() => {});
        expect(apiFetch).toHaveBeenCalled();
        const [reqPath, options = {}] = apiFetch.mock.calls[apiFetch.mock.calls.length - 1];
        expect(String(options.method || 'GET')).toBe('PATCH');
        expect(String(reqPath)).toContain("/orders/");
        expect(String(reqPath)).toContain("/command-center/refund/");
        expect(String(reqPath)).toContain("/admin");
        expect(options.headers && options.headers.Authorization).toBe('Bearer test');
    });

    it("processReplacementRequestAdmin calls PATCH /orders/${orderId}/command-center/replace/${requestId}/admin", async () => {
        await orderApi.processReplacementRequestAdmin(anyArgs).catch(() => {});
        expect(apiFetch).toHaveBeenCalled();
        const [reqPath, options = {}] = apiFetch.mock.calls[apiFetch.mock.calls.length - 1];
        expect(String(options.method || 'GET')).toBe('PATCH');
        expect(String(reqPath)).toContain("/orders/");
        expect(String(reqPath)).toContain("/command-center/replace/");
        expect(String(reqPath)).toContain("/admin");
        expect(options.headers && options.headers.Authorization).toBe('Bearer test');
    });

    it("replySupportAdmin calls POST /orders/${orderId}/command-center/support/admin-reply", async () => {
        await orderApi.replySupportAdmin(anyArgs).catch(() => {});
        expect(apiFetch).toHaveBeenCalled();
        const [reqPath, options = {}] = apiFetch.mock.calls[apiFetch.mock.calls.length - 1];
        expect(String(options.method || 'GET')).toBe('POST');
        expect(String(reqPath)).toContain("/orders/");
        expect(String(reqPath)).toContain("/command-center/support/admin-reply");
        expect(options.headers && options.headers.Authorization).toBe('Bearer test');
    });

    it("processWarrantyClaimAdmin calls PATCH /orders/${orderId}/command-center/warranty/${claimId}/admin", async () => {
        await orderApi.processWarrantyClaimAdmin(anyArgs).catch(() => {});
        expect(apiFetch).toHaveBeenCalled();
        const [reqPath, options = {}] = apiFetch.mock.calls[apiFetch.mock.calls.length - 1];
        expect(String(options.method || 'GET')).toBe('PATCH');
        expect(String(reqPath)).toContain("/orders/");
        expect(String(reqPath)).toContain("/command-center/warranty/");
        expect(String(reqPath)).toContain("/admin");
        expect(options.headers && options.headers.Authorization).toBe('Bearer test');
    });

    it("getAllOrders calls GET /orders${buildQueryString({\n            limit: ORDER_LIST_PAGE_SIZE,\n            ...params,\n        })}", async () => {
        await orderApi.getAllOrders(anyArgs).catch(() => {});
        expect(apiFetch).toHaveBeenCalled();
        const [reqPath, options = {}] = apiFetch.mock.calls[apiFetch.mock.calls.length - 1];
        expect(String(options.method || 'GET')).toBe('GET');
        expect(String(reqPath)).toContain("/orders");
        expect(options.headers && options.headers.Authorization).toBe('Bearer test');
    });

    it("updateOrderStatusAdmin calls PATCH /orders/${orderId}/status", async () => {
        await orderApi.updateOrderStatusAdmin(anyArgs).catch(() => {});
        expect(apiFetch).toHaveBeenCalled();
        const [reqPath, options = {}] = apiFetch.mock.calls[apiFetch.mock.calls.length - 1];
        expect(String(options.method || 'GET')).toBe('PATCH');
        expect(String(reqPath)).toContain("/orders/");
        expect(String(reqPath)).toContain("/status");
        expect(options.headers && options.headers.Authorization).toBe('Bearer test');
    });

});

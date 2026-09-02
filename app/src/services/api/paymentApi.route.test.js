// AUTO-GENERATED route-contract suite for paymentApi.js — do not edit by hand.
// Regenerate with: node scripts/generate-api-client-tests.cjs paymentApi.js
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
import { paymentApi } from './paymentApi';

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

describe('paymentApi route contract', () => {
    it("createIntent calls POST /payments/intents", async () => {
        await paymentApi.createIntent(anyArgs).catch(() => {});
        expect(apiFetch).toHaveBeenCalled();
        const [reqPath, options = {}] = apiFetch.mock.calls[apiFetch.mock.calls.length - 1];
        expect(String(options.method || 'GET')).toBe('POST');
        expect(String(reqPath)).toBe("/payments/intents");
        expect(options.headers && options.headers.Authorization).toBe('Bearer test');
    });

    it("confirmIntent calls POST /payments/intents/${intentId}/confirm", async () => {
        await paymentApi.confirmIntent(anyArgs).catch(() => {});
        expect(apiFetch).toHaveBeenCalled();
        const [reqPath, options = {}] = apiFetch.mock.calls[apiFetch.mock.calls.length - 1];
        expect(String(options.method || 'GET')).toBe('POST');
        expect(String(reqPath)).toContain("/payments/intents/");
        expect(String(reqPath)).toContain("/confirm");
        expect(options.headers && options.headers.Authorization).toBe('Bearer test');
    });

    it("completeChallenge calls POST /payments/intents/${intentId}/challenge/complete", async () => {
        await paymentApi.completeChallenge(anyArgs).catch(() => {});
        expect(apiFetch).toHaveBeenCalled();
        const [reqPath, options = {}] = apiFetch.mock.calls[apiFetch.mock.calls.length - 1];
        expect(String(options.method || 'GET')).toBe('POST');
        expect(String(reqPath)).toContain("/payments/intents/");
        expect(String(reqPath)).toContain("/challenge/complete");
        expect(options.headers && options.headers.Authorization).toBe('Bearer test');
    });

    it("getIntent calls GET /payments/intents/${intentId}", async () => {
        await paymentApi.getIntent(anyArgs).catch(() => {});
        expect(apiFetch).toHaveBeenCalled();
        const [reqPath, options = {}] = apiFetch.mock.calls[apiFetch.mock.calls.length - 1];
        expect(String(options.method || 'GET')).toBe('GET');
        expect(String(reqPath)).toContain("/payments/intents/");
        expect(options.headers && options.headers.Authorization).toBe('Bearer test');
    });

    it("createRefund calls POST /payments/intents/${intentId}/refunds", async () => {
        await paymentApi.createRefund(anyArgs).catch(() => {});
        expect(apiFetch).toHaveBeenCalled();
        const [reqPath, options = {}] = apiFetch.mock.calls[apiFetch.mock.calls.length - 1];
        expect(String(options.method || 'GET')).toBe('POST');
        expect(String(reqPath)).toContain("/payments/intents/");
        expect(String(reqPath)).toContain("/refunds");
        expect(options.headers && options.headers.Authorization).toBe('Bearer test');
    });

    it("getMethods calls GET /payments/methods", async () => {
        await paymentApi.getMethods(anyArgs).catch(() => {});
        expect(apiFetch).toHaveBeenCalled();
        const [reqPath, options = {}] = apiFetch.mock.calls[apiFetch.mock.calls.length - 1];
        expect(String(options.method || 'GET')).toBe('GET');
        expect(String(reqPath)).toBe("/payments/methods");
        expect(options.headers && options.headers.Authorization).toBe('Bearer test');
    });

    it("getCapabilities calls GET /payments/capabilities", async () => {
        await paymentApi.getCapabilities(anyArgs).catch(() => {});
        expect(apiFetch).toHaveBeenCalled();
        const [reqPath, options = {}] = apiFetch.mock.calls[apiFetch.mock.calls.length - 1];
        expect(String(options.method || 'GET')).toBe('GET');
        expect(String(reqPath)).toBe("/payments/capabilities");
        expect(options.headers && options.headers.Authorization).toBe('Bearer test');
    });

    it("getNetbankingBanks calls GET /payments/netbanking/banks", async () => {
        await paymentApi.getNetbankingBanks(anyArgs).catch(() => {});
        expect(apiFetch).toHaveBeenCalled();
        const [reqPath, options = {}] = apiFetch.mock.calls[apiFetch.mock.calls.length - 1];
        expect(String(options.method || 'GET')).toBe('GET');
        expect(String(reqPath)).toBe("/payments/netbanking/banks");
        expect(options.headers && options.headers.Authorization).toBe('Bearer test');
    });

    it("createMethodSetupIntent calls POST /payments/methods/setup-intent", async () => {
        await paymentApi.createMethodSetupIntent(anyArgs).catch(() => {});
        expect(apiFetch).toHaveBeenCalled();
        const [reqPath, options = {}] = apiFetch.mock.calls[apiFetch.mock.calls.length - 1];
        expect(String(options.method || 'GET')).toBe('POST');
        expect(String(reqPath)).toBe("/payments/methods/setup-intent");
        expect(options.headers && options.headers.Authorization).toBe('Bearer test');
    });

    it("saveMethod calls POST /payments/methods", async () => {
        await paymentApi.saveMethod(anyArgs).catch(() => {});
        expect(apiFetch).toHaveBeenCalled();
        const [reqPath, options = {}] = apiFetch.mock.calls[apiFetch.mock.calls.length - 1];
        expect(String(options.method || 'GET')).toBe('POST');
        expect(String(reqPath)).toBe("/payments/methods");
        expect(options.headers && options.headers.Authorization).toBe('Bearer test');
    });

    it("setDefaultMethod calls PATCH /payments/methods/${methodId}/default", async () => {
        await paymentApi.setDefaultMethod(anyArgs).catch(() => {});
        expect(apiFetch).toHaveBeenCalled();
        const [reqPath, options = {}] = apiFetch.mock.calls[apiFetch.mock.calls.length - 1];
        expect(String(options.method || 'GET')).toBe('PATCH');
        expect(String(reqPath)).toContain("/payments/methods/");
        expect(String(reqPath)).toContain("/default");
        expect(options.headers && options.headers.Authorization).toBe('Bearer test');
    });

    it("deleteMethod calls DELETE /payments/methods/${methodId}", async () => {
        await paymentApi.deleteMethod(anyArgs).catch(() => {});
        expect(apiFetch).toHaveBeenCalled();
        const [reqPath, options = {}] = apiFetch.mock.calls[apiFetch.mock.calls.length - 1];
        expect(String(options.method || 'GET')).toBe('DELETE');
        expect(String(reqPath)).toContain("/payments/methods/");
        expect(options.headers && options.headers.Authorization).toBe('Bearer test');
    });

    it("getAdminPayments calls GET /admin/payments", async () => {
        await paymentApi.getAdminPayments(anyArgs).catch(() => {});
        expect(apiFetch).toHaveBeenCalled();
        const [reqPath, options = {}] = apiFetch.mock.calls[apiFetch.mock.calls.length - 1];
        expect(String(options.method || 'GET')).toBe('GET');
        expect(String(reqPath)).toBe("/admin/payments");
        expect(options.headers && options.headers.Authorization).toBe('Bearer test');
    });

    it("getAdminPaymentOpsOverview calls GET /admin/payments/ops/overview", async () => {
        await paymentApi.getAdminPaymentOpsOverview(anyArgs).catch(() => {});
        expect(apiFetch).toHaveBeenCalled();
        const [reqPath, options = {}] = apiFetch.mock.calls[apiFetch.mock.calls.length - 1];
        expect(String(options.method || 'GET')).toBe('GET');
        expect(String(reqPath)).toBe("/admin/payments/ops/overview");
        expect(options.headers && options.headers.Authorization).toBe('Bearer test');
    });

    it("expireAdminStaleIntents calls POST /admin/payments/ops/expire-stale", async () => {
        await paymentApi.expireAdminStaleIntents(anyArgs).catch(() => {});
        expect(apiFetch).toHaveBeenCalled();
        const [reqPath, options = {}] = apiFetch.mock.calls[apiFetch.mock.calls.length - 1];
        expect(String(options.method || 'GET')).toBe('POST');
        expect(String(reqPath)).toBe("/admin/payments/ops/expire-stale");
        expect(options.headers && options.headers.Authorization).toBe('Bearer test');
    });

    it("getRefundLedger calls GET /admin/payments/refunds/ledger", async () => {
        await paymentApi.getRefundLedger(anyArgs).catch(() => {});
        expect(apiFetch).toHaveBeenCalled();
        const [reqPath, options = {}] = apiFetch.mock.calls[apiFetch.mock.calls.length - 1];
        expect(String(options.method || 'GET')).toBe('GET');
        expect(String(reqPath)).toBe("/admin/payments/refunds/ledger");
        expect(options.headers && options.headers.Authorization).toBe('Bearer test');
    });

    it("updateRefundLedgerReference calls PATCH /admin/payments/refunds/ledger/${orderId}/${requestId}/reference", async () => {
        await paymentApi.updateRefundLedgerReference(anyArgs).catch(() => {});
        expect(apiFetch).toHaveBeenCalled();
        const [reqPath, options = {}] = apiFetch.mock.calls[apiFetch.mock.calls.length - 1];
        expect(String(options.method || 'GET')).toBe('PATCH');
        expect(String(reqPath)).toContain("/admin/payments/refunds/ledger/");
        expect(String(reqPath)).toContain("/");
        expect(String(reqPath)).toContain("/reference");
        expect(options.headers && options.headers.Authorization).toBe('Bearer test');
    });

    it("getAdminPaymentById calls GET /admin/payments/${intentId}", async () => {
        await paymentApi.getAdminPaymentById(anyArgs).catch(() => {});
        expect(apiFetch).toHaveBeenCalled();
        const [reqPath, options = {}] = apiFetch.mock.calls[apiFetch.mock.calls.length - 1];
        expect(String(options.method || 'GET')).toBe('GET');
        expect(String(reqPath)).toContain("/admin/payments/");
        expect(options.headers && options.headers.Authorization).toBe('Bearer test');
    });

    it("captureAdminPayment calls POST /admin/payments/${intentId}/capture", async () => {
        await paymentApi.captureAdminPayment(anyArgs).catch(() => {});
        expect(apiFetch).toHaveBeenCalled();
        const [reqPath, options = {}] = apiFetch.mock.calls[apiFetch.mock.calls.length - 1];
        expect(String(options.method || 'GET')).toBe('POST');
        expect(String(reqPath)).toContain("/admin/payments/");
        expect(String(reqPath)).toContain("/capture");
        expect(options.headers && options.headers.Authorization).toBe('Bearer test');
    });

    it("retryAdminCapture calls POST /admin/payments/${intentId}/retry-capture", async () => {
        await paymentApi.retryAdminCapture(anyArgs).catch(() => {});
        expect(apiFetch).toHaveBeenCalled();
        const [reqPath, options = {}] = apiFetch.mock.calls[apiFetch.mock.calls.length - 1];
        expect(String(options.method || 'GET')).toBe('POST');
        expect(String(reqPath)).toContain("/admin/payments/");
        expect(String(reqPath)).toContain("/retry-capture");
        expect(options.headers && options.headers.Authorization).toBe('Bearer test');
    });

});

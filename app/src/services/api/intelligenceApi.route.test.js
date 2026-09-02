// AUTO-GENERATED route-contract suite for intelligenceApi.js — do not edit by hand.
// Regenerate with: node scripts/generate-api-client-tests.cjs intelligenceApi.js
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
import { intelligenceApi, priceAlertApi } from './intelligenceApi';

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

describe('intelligenceApi route contract', () => {
    it("optimizeRewards calls POST /intelligence/optimize-rewards", async () => {
        await intelligenceApi.optimizeRewards(anyArgs).catch(() => {});
        expect(apiFetch).toHaveBeenCalled();
        const [reqPath, options = {}] = apiFetch.mock.calls[apiFetch.mock.calls.length - 1];
        expect(String(options.method || 'GET')).toBe('POST');
        expect(String(reqPath)).toBe("/intelligence/optimize-rewards");
        expect(options.headers && options.headers.Authorization).toBe('Bearer test');
    });

    it("getLatestRewards calls GET /intelligence/latest-rewards", async () => {
        await intelligenceApi.getLatestRewards(anyArgs).catch(() => {});
        expect(apiFetch).toHaveBeenCalled();
        const [reqPath, options = {}] = apiFetch.mock.calls[apiFetch.mock.calls.length - 1];
        expect(String(options.method || 'GET')).toBe('GET');
        expect(String(reqPath)).toBe("/intelligence/latest-rewards");
        expect(options.headers && options.headers.Authorization).toBe('Bearer test');
    });

});

describe('priceAlertApi route contract', () => {
    it("create calls POST /price-alerts", async () => {
        await priceAlertApi.create(anyArgs).catch(() => {});
        expect(apiFetch).toHaveBeenCalled();
        const [reqPath, options = {}] = apiFetch.mock.calls[apiFetch.mock.calls.length - 1];
        expect(String(options.method || 'GET')).toBe('POST');
        expect(String(reqPath)).toBe("/price-alerts");
        expect(options.headers && options.headers.Authorization).toBe('Bearer test');
    });

    it("getMyAlerts calls GET /price-alerts/my", async () => {
        await priceAlertApi.getMyAlerts(anyArgs).catch(() => {});
        expect(apiFetch).toHaveBeenCalled();
        const [reqPath, options = {}] = apiFetch.mock.calls[apiFetch.mock.calls.length - 1];
        expect(String(options.method || 'GET')).toBe('GET');
        expect(String(reqPath)).toBe("/price-alerts/my");
        expect(options.headers && options.headers.Authorization).toBe('Bearer test');
    });

    it("delete calls DELETE /price-alerts/${id}", async () => {
        await priceAlertApi.delete(anyArgs).catch(() => {});
        expect(apiFetch).toHaveBeenCalled();
        const [reqPath, options = {}] = apiFetch.mock.calls[apiFetch.mock.calls.length - 1];
        expect(String(options.method || 'GET')).toBe('DELETE');
        expect(String(reqPath)).toContain("/price-alerts/");
        expect(options.headers && options.headers.Authorization).toBe('Bearer test');
    });

    it("getHistory calls GET /price-alerts/history/${productId}", async () => {
        await priceAlertApi.getHistory(anyArgs).catch(() => {});
        expect(apiFetch).toHaveBeenCalled();
        const [reqPath, options = {}] = apiFetch.mock.calls[apiFetch.mock.calls.length - 1];
        expect(String(options.method || 'GET')).toBe('GET');
        expect(String(reqPath)).toContain("/price-alerts/history/");
        expect(options.headers && options.headers.Authorization).toBe('Bearer test');
    });

});

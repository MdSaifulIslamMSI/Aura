// AUTO-GENERATED route-contract suite for recommendationApi.js — do not edit by hand.
// Regenerate with: node scripts/generate-api-client-tests.cjs recommendationApi.js
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
import { recommendationApi } from './recommendationApi';

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

describe('recommendationApi route contract', () => {
    it("getHomeRecommendations calls GET /recommendations/home", async () => {
        await recommendationApi.getHomeRecommendations(anyArgs).catch(() => {});
        expect(apiFetch).toHaveBeenCalled();
        const [reqPath, options = {}] = apiFetch.mock.calls[apiFetch.mock.calls.length - 1];
        expect(String(options.method || 'GET')).toBe('GET');
        expect(String(reqPath)).toBe("/recommendations/home");
        expect(options.headers && options.headers.Authorization).toBe('Bearer test');
    });

    it("getSimilarProducts calls GET /recommendations/similar/${productId}", async () => {
        await recommendationApi.getSimilarProducts(anyArgs).catch(() => {});
        expect(apiFetch).toHaveBeenCalled();
        const [reqPath, options = {}] = apiFetch.mock.calls[apiFetch.mock.calls.length - 1];
        expect(String(options.method || 'GET')).toBe('GET');
        expect(String(reqPath)).toContain("/recommendations/similar/");
        expect(options.headers && options.headers.Authorization).toBe('Bearer test');
    });

    it("getCartRecommendations calls POST /recommendations/cart", async () => {
        await recommendationApi.getCartRecommendations(anyArgs).catch(() => {});
        expect(apiFetch).toHaveBeenCalled();
        const [reqPath, options = {}] = apiFetch.mock.calls[apiFetch.mock.calls.length - 1];
        expect(String(options.method || 'GET')).toBe('POST');
        expect(String(reqPath)).toBe("/recommendations/cart");
        expect(options.headers && options.headers.Authorization).toBe('Bearer test');
    });

    it("getTrendingProducts calls GET /recommendations/trending", async () => {
        await recommendationApi.getTrendingProducts(anyArgs).catch(() => {});
        expect(apiFetch).toHaveBeenCalled();
        const [reqPath, options = {}] = apiFetch.mock.calls[apiFetch.mock.calls.length - 1];
        expect(String(options.method || 'GET')).toBe('GET');
        expect(String(reqPath)).toBe("/recommendations/trending");
    });

    it("getRecentlyViewedRecommendations calls GET /recommendations/recently-viewed", async () => {
        await recommendationApi.getRecentlyViewedRecommendations(anyArgs).catch(() => {});
        expect(apiFetch).toHaveBeenCalled();
        const [reqPath, options = {}] = apiFetch.mock.calls[apiFetch.mock.calls.length - 1];
        expect(String(options.method || 'GET')).toBe('GET');
        expect(String(reqPath)).toBe("/recommendations/recently-viewed");
        expect(options.headers && options.headers.Authorization).toBe('Bearer test');
    });

    it("getSearchRecommendations calls GET /recommendations/search", async () => {
        await recommendationApi.getSearchRecommendations(anyArgs).catch(() => {});
        expect(apiFetch).toHaveBeenCalled();
        const [reqPath, options = {}] = apiFetch.mock.calls[apiFetch.mock.calls.length - 1];
        expect(String(options.method || 'GET')).toBe('GET');
        expect(String(reqPath)).toBe("/recommendations/search");
        expect(options.headers && options.headers.Authorization).toBe('Bearer test');
    });

    it("getFrequentlyBoughtTogether calls GET /recommendations/frequently-bought/${productId}", async () => {
        await recommendationApi.getFrequentlyBoughtTogether(anyArgs).catch(() => {});
        expect(apiFetch).toHaveBeenCalled();
        const [reqPath, options = {}] = apiFetch.mock.calls[apiFetch.mock.calls.length - 1];
        expect(String(options.method || 'GET')).toBe('GET');
        expect(String(reqPath)).toContain("/recommendations/frequently-bought/");
    });

    it("getAssistantRecommendations calls POST /recommendations/assistant", async () => {
        await recommendationApi.getAssistantRecommendations(anyArgs).catch(() => {});
        expect(apiFetch).toHaveBeenCalled();
        const [reqPath, options = {}] = apiFetch.mock.calls[apiFetch.mock.calls.length - 1];
        expect(String(options.method || 'GET')).toBe('POST');
        expect(String(reqPath)).toBe("/recommendations/assistant");
        expect(options.headers && options.headers.Authorization).toBe('Bearer test');
    });

});

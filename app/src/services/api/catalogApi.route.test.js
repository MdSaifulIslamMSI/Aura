// AUTO-GENERATED route-contract suite for catalogApi.js — do not edit by hand.
// Regenerate with: node scripts/generate-api-client-tests.cjs catalogApi.js
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
import { catalogApi } from './catalogApi';

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

describe('catalogApi route contract', () => {
    it("getProducts calls GET /products", async () => {
        await catalogApi.getProducts(anyArgs).catch(() => {});
        expect(apiFetch).toHaveBeenCalled();
        const [reqPath, options = {}] = apiFetch.mock.calls[apiFetch.mock.calls.length - 1];
        expect(String(options.method || 'GET')).toBe('GET');
        expect(String(reqPath)).toBe("/products");
    });

    it("getProductReviews calls GET /products/${id}/reviews", async () => {
        await catalogApi.getProductReviews(anyArgs).catch(() => {});
        expect(apiFetch).toHaveBeenCalled();
        const [reqPath, options = {}] = apiFetch.mock.calls[apiFetch.mock.calls.length - 1];
        expect(String(options.method || 'GET')).toBe('GET');
        expect(String(reqPath)).toContain("/products/");
        expect(String(reqPath)).toContain("/reviews");
    });

    it("createProductReview calls POST /products/${id}/reviews", async () => {
        await catalogApi.createProductReview(anyArgs).catch(() => {});
        expect(apiFetch).toHaveBeenCalled();
        const [reqPath, options = {}] = apiFetch.mock.calls[apiFetch.mock.calls.length - 1];
        expect(String(options.method || 'GET')).toBe('POST');
        expect(String(reqPath)).toContain("/products/");
        expect(String(reqPath)).toContain("/reviews");
        expect(options.headers && options.headers.Authorization).toBe('Bearer test');
    });

    it("visualSearch calls POST /products/visual-search", async () => {
        await catalogApi.visualSearch(anyArgs).catch(() => {});
        expect(apiFetch).toHaveBeenCalled();
        const [reqPath, options = {}] = apiFetch.mock.calls[apiFetch.mock.calls.length - 1];
        expect(String(options.method || 'GET')).toBe('POST');
        expect(String(reqPath)).toBe("/products/visual-search");
    });

    it("buildSmartBundle calls POST /products/bundles/build", async () => {
        await catalogApi.buildSmartBundle(anyArgs).catch(() => {});
        expect(apiFetch).toHaveBeenCalled();
        const [reqPath, options = {}] = apiFetch.mock.calls[apiFetch.mock.calls.length - 1];
        expect(String(options.method || 'GET')).toBe('POST');
        expect(String(reqPath)).toBe("/products/bundles/build");
    });

    it("getDealDna calls GET /products/${id}/deal-dna", async () => {
        await catalogApi.getDealDna(anyArgs).catch(() => {});
        expect(apiFetch).toHaveBeenCalled();
        const [reqPath, options = {}] = apiFetch.mock.calls[apiFetch.mock.calls.length - 1];
        expect(String(options.method || 'GET')).toBe('GET');
        expect(String(reqPath)).toContain("/products/");
        expect(String(reqPath)).toContain("/deal-dna");
    });

    it("getCompatibility calls GET /products/${id}/compatibility", async () => {
        await catalogApi.getCompatibility(anyArgs).catch(() => {});
        expect(apiFetch).toHaveBeenCalled();
        const [reqPath, options = {}] = apiFetch.mock.calls[apiFetch.mock.calls.length - 1];
        expect(String(options.method || 'GET')).toBe('GET');
        expect(String(reqPath)).toContain("/products/");
        expect(String(reqPath)).toContain("/compatibility");
    });

    it("getRecommendations calls POST /products/recommendations", async () => {
        await catalogApi.getRecommendations(anyArgs).catch(() => {});
        expect(apiFetch).toHaveBeenCalled();
        const [reqPath, options = {}] = apiFetch.mock.calls[apiFetch.mock.calls.length - 1];
        expect(String(options.method || 'GET')).toBe('POST');
        expect(String(reqPath)).toBe("/products/recommendations");
        expect(options.headers && options.headers.Authorization).toBe('Bearer test');
    });

    it("createProduct calls POST /products", async () => {
        await catalogApi.createProduct(anyArgs).catch(() => {});
        expect(apiFetch).toHaveBeenCalled();
        const [reqPath, options = {}] = apiFetch.mock.calls[apiFetch.mock.calls.length - 1];
        expect(String(options.method || 'GET')).toBe('POST');
        expect(String(reqPath)).toBe("/products");
        expect(options.headers && options.headers.Authorization).toBe('Bearer test');
    });

    it("updateProduct calls PUT /products/${_id || id}", async () => {
        await catalogApi.updateProduct(anyArgs).catch(() => {});
        expect(apiFetch).toHaveBeenCalled();
        const [reqPath, options = {}] = apiFetch.mock.calls[apiFetch.mock.calls.length - 1];
        expect(String(options.method || 'GET')).toBe('PUT');
        expect(String(reqPath)).toContain("/products/");
        expect(options.headers && options.headers.Authorization).toBe('Bearer test');
    });

    it("deleteProduct calls DELETE /products/${id}", async () => {
        await catalogApi.deleteProduct(anyArgs).catch(() => {});
        expect(apiFetch).toHaveBeenCalled();
        const [reqPath, options = {}] = apiFetch.mock.calls[apiFetch.mock.calls.length - 1];
        expect(String(options.method || 'GET')).toBe('DELETE');
        expect(String(reqPath)).toContain("/products/");
        expect(options.headers && options.headers.Authorization).toBe('Bearer test');
    });

});

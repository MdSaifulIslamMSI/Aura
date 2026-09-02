// AUTO-GENERATED route-contract suite for uploadApi.js — do not edit by hand.
// Regenerate with: node scripts/generate-api-client-tests.cjs uploadApi.js
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
import { uploadApi } from './uploadApi';

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

describe('uploadApi route contract', () => {
    it("signReviewMediaUpload calls POST /uploads/reviews/sign", async () => {
        await uploadApi.signReviewMediaUpload(anyArgs).catch(() => {});
        expect(apiFetch).toHaveBeenCalled();
        const [reqPath, options = {}] = apiFetch.mock.calls[apiFetch.mock.calls.length - 1];
        expect(String(options.method || 'GET')).toBe('POST');
        expect(String(reqPath)).toBe("/uploads/reviews/sign");
        expect(options.headers && options.headers.Authorization).toBe('Bearer test');
    });

    // Override: Method converts `file` to a data URL via FileReader before any network call; a static test can only assert the fast-fail path.
    it("uploadSignedReviewMedia fails fast without network for static placeholder input", async () => {
        await expect(uploadApi.uploadSignedReviewMedia(anyArgs)).rejects.toThrow();
        expect(apiFetch).not.toHaveBeenCalled();
    });

});

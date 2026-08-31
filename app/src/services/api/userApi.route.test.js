// AUTO-GENERATED route-contract suite for userApi.js — do not edit by hand.
// Regenerate with: node scripts/generate-api-client-tests.cjs userApi.js
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
import { userApi } from './userApi';

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

describe('userApi route contract', () => {
    it("login calls POST /auth/sync", async () => {
        await userApi.login(anyArgs).catch(() => {});
        expect(apiFetch).toHaveBeenCalled();
        const [reqPath, options = {}] = apiFetch.mock.calls[apiFetch.mock.calls.length - 1];
        expect(String(options.method || 'GET')).toBe('POST');
        expect(String(reqPath)).toBe("/auth/sync");
        expect(options.headers && options.headers.Authorization).toBe('Bearer test');
    });

    it("getProfile calls GET /users/profile", async () => {
        await userApi.getProfile(anyArgs).catch(() => {});
        expect(apiFetch).toHaveBeenCalled();
        const [reqPath, options = {}] = apiFetch.mock.calls[apiFetch.mock.calls.length - 1];
        expect(String(options.method || 'GET')).toBe('GET');
        expect(String(reqPath)).toBe("/users/profile");
        expect(options.headers && options.headers.Authorization).toBe('Bearer test');
    });

    it("getAccountOverview calls GET /account/summary", async () => {
        await userApi.getAccountOverview(anyArgs).catch(() => {});
        expect(apiFetch).toHaveBeenCalled();
        const [reqPath, options = {}] = apiFetch.mock.calls[apiFetch.mock.calls.length - 1];
        expect(String(options.method || 'GET')).toBe('GET');
        expect(String(reqPath)).toBe("/account/summary");
        expect(options.headers && options.headers.Authorization).toBe('Bearer test');
    });

    it("getAccountPreferences calls GET /account/preferences", async () => {
        await userApi.getAccountPreferences(anyArgs).catch(() => {});
        expect(apiFetch).toHaveBeenCalled();
        const [reqPath, options = {}] = apiFetch.mock.calls[apiFetch.mock.calls.length - 1];
        expect(String(options.method || 'GET')).toBe('GET');
        expect(String(reqPath)).toBe("/account/preferences");
        expect(options.headers && options.headers.Authorization).toBe('Bearer test');
    });

    it("updateAccountPreferences calls PATCH /account/preferences", async () => {
        await userApi.updateAccountPreferences(anyArgs).catch(() => {});
        expect(apiFetch).toHaveBeenCalled();
        const [reqPath, options = {}] = apiFetch.mock.calls[apiFetch.mock.calls.length - 1];
        expect(String(options.method || 'GET')).toBe('PATCH');
        expect(String(reqPath)).toBe("/account/preferences");
        expect(options.headers && options.headers.Authorization).toBe('Bearer test');
    });

    it("updateProfile calls PUT /users/profile", async () => {
        await userApi.updateProfile(anyArgs).catch(() => {});
        expect(apiFetch).toHaveBeenCalled();
        const [reqPath, options = {}] = apiFetch.mock.calls[apiFetch.mock.calls.length - 1];
        expect(String(options.method || 'GET')).toBe('PUT');
        expect(String(reqPath)).toBe("/users/profile");
        expect(options.headers && options.headers.Authorization).toBe('Bearer test');
    });

    it("syncWishlist calls PUT /users/wishlist", async () => {
        await userApi.syncWishlist(anyArgs).catch(() => {});
        expect(apiFetch).toHaveBeenCalled();
        const [reqPath, options = {}] = apiFetch.mock.calls[apiFetch.mock.calls.length - 1];
        expect(String(options.method || 'GET')).toBe('PUT');
        expect(String(reqPath)).toBe("/users/wishlist");
        expect(options.headers && options.headers.Authorization).toBe('Bearer test');
    });

    it("getWishlist calls GET /users/wishlist", async () => {
        await userApi.getWishlist(anyArgs).catch(() => {});
        expect(apiFetch).toHaveBeenCalled();
        const [reqPath, options = {}] = apiFetch.mock.calls[apiFetch.mock.calls.length - 1];
        expect(String(options.method || 'GET')).toBe('GET');
        expect(String(reqPath)).toBe("/users/wishlist");
        expect(options.headers && options.headers.Authorization).toBe('Bearer test');
    });

    it("addWishlistItem calls POST /users/wishlist/items", async () => {
        await userApi.addWishlistItem(anyArgs).catch(() => {});
        expect(apiFetch).toHaveBeenCalled();
        const [reqPath, options = {}] = apiFetch.mock.calls[apiFetch.mock.calls.length - 1];
        expect(String(options.method || 'GET')).toBe('POST');
        expect(String(reqPath)).toBe("/users/wishlist/items");
        expect(options.headers && options.headers.Authorization).toBe('Bearer test');
    });

    it("removeWishlistItem calls DELETE /users/wishlist/items/${productId}", async () => {
        await userApi.removeWishlistItem(anyArgs).catch(() => {});
        expect(apiFetch).toHaveBeenCalled();
        const [reqPath, options = {}] = apiFetch.mock.calls[apiFetch.mock.calls.length - 1];
        expect(String(options.method || 'GET')).toBe('DELETE');
        expect(String(reqPath)).toContain("/users/wishlist/items/");
        expect(options.headers && options.headers.Authorization).toBe('Bearer test');
    });

    it("mergeWishlist calls POST /users/wishlist/merge", async () => {
        await userApi.mergeWishlist(anyArgs).catch(() => {});
        expect(apiFetch).toHaveBeenCalled();
        const [reqPath, options = {}] = apiFetch.mock.calls[apiFetch.mock.calls.length - 1];
        expect(String(options.method || 'GET')).toBe('POST');
        expect(String(reqPath)).toBe("/users/wishlist/merge");
        expect(options.headers && options.headers.Authorization).toBe('Bearer test');
    });

    it("getRewards calls GET /users/rewards", async () => {
        await userApi.getRewards(anyArgs).catch(() => {});
        expect(apiFetch).toHaveBeenCalled();
        const [reqPath, options = {}] = apiFetch.mock.calls[apiFetch.mock.calls.length - 1];
        expect(String(options.method || 'GET')).toBe('GET');
        expect(String(reqPath)).toBe("/users/rewards");
        expect(options.headers && options.headers.Authorization).toBe('Bearer test');
    });

    it("activateSeller calls POST /users/seller/activate", async () => {
        await userApi.activateSeller(anyArgs).catch(() => {});
        expect(apiFetch).toHaveBeenCalled();
        const [reqPath, options = {}] = apiFetch.mock.calls[apiFetch.mock.calls.length - 1];
        expect(String(options.method || 'GET')).toBe('POST');
        expect(String(reqPath)).toBe("/users/seller/activate");
        expect(options.headers && options.headers.Authorization).toBe('Bearer test');
    });

    it("getAddresses calls GET /users/addresses", async () => {
        await userApi.getAddresses(anyArgs).catch(() => {});
        expect(apiFetch).toHaveBeenCalled();
        const [reqPath, options = {}] = apiFetch.mock.calls[apiFetch.mock.calls.length - 1];
        expect(String(options.method || 'GET')).toBe('GET');
        expect(String(reqPath)).toBe("/users/addresses");
        expect(options.headers && options.headers.Authorization).toBe('Bearer test');
    });

    it("addAddress calls POST /users/addresses", async () => {
        await userApi.addAddress(anyArgs).catch(() => {});
        expect(apiFetch).toHaveBeenCalled();
        const [reqPath, options = {}] = apiFetch.mock.calls[apiFetch.mock.calls.length - 1];
        expect(String(options.method || 'GET')).toBe('POST');
        expect(String(reqPath)).toBe("/users/addresses");
        expect(options.headers && options.headers.Authorization).toBe('Bearer test');
    });

    it("updateAddress calls PUT /users/addresses/${addressId}", async () => {
        await userApi.updateAddress(anyArgs).catch(() => {});
        expect(apiFetch).toHaveBeenCalled();
        const [reqPath, options = {}] = apiFetch.mock.calls[apiFetch.mock.calls.length - 1];
        expect(String(options.method || 'GET')).toBe('PUT');
        expect(String(reqPath)).toContain("/users/addresses/");
        expect(options.headers && options.headers.Authorization).toBe('Bearer test');
    });

    it("deleteAddress calls DELETE /users/addresses/${addressId}", async () => {
        await userApi.deleteAddress(anyArgs).catch(() => {});
        expect(apiFetch).toHaveBeenCalled();
        const [reqPath, options = {}] = apiFetch.mock.calls[apiFetch.mock.calls.length - 1];
        expect(String(options.method || 'GET')).toBe('DELETE');
        expect(String(reqPath)).toContain("/users/addresses/");
        expect(options.headers && options.headers.Authorization).toBe('Bearer test');
    });

    it("getDashboard calls GET /users/dashboard", async () => {
        await userApi.getDashboard(anyArgs).catch(() => {});
        expect(apiFetch).toHaveBeenCalled();
        const [reqPath, options = {}] = apiFetch.mock.calls[apiFetch.mock.calls.length - 1];
        expect(String(options.method || 'GET')).toBe('GET');
        expect(String(reqPath)).toBe("/users/dashboard");
        expect(options.headers && options.headers.Authorization).toBe('Bearer test');
    });

});

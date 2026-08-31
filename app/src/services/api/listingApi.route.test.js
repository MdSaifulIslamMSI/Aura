// AUTO-GENERATED route-contract suite for listingApi.js — do not edit by hand.
// Regenerate with: node scripts/generate-api-client-tests.cjs listingApi.js
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
import { listingApi, tradeInApi } from './listingApi';

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

describe('listingApi route contract', () => {
    it("getListings calls GET /listings", async () => {
        await listingApi.getListings(anyArgs).catch(() => {});
        expect(apiFetch).toHaveBeenCalled();
        const [reqPath, options = {}] = apiFetch.mock.calls[apiFetch.mock.calls.length - 1];
        expect(String(options.method || 'GET')).toBe('GET');
        expect(String(reqPath)).toBe("/listings");
        expect(options.headers && options.headers.Authorization).toBe('Bearer test');
    });

    it("getListingById calls GET /listings/${id}", async () => {
        await listingApi.getListingById(anyArgs).catch(() => {});
        expect(apiFetch).toHaveBeenCalled();
        const [reqPath, options = {}] = apiFetch.mock.calls[apiFetch.mock.calls.length - 1];
        expect(String(options.method || 'GET')).toBe('GET');
        expect(String(reqPath)).toContain("/listings/");
        expect(options.headers && options.headers.Authorization).toBe('Bearer test');
    });

    it("createListing calls POST /listings", async () => {
        await listingApi.createListing(anyArgs).catch(() => {});
        expect(apiFetch).toHaveBeenCalled();
        const [reqPath, options = {}] = apiFetch.mock.calls[apiFetch.mock.calls.length - 1];
        expect(String(options.method || 'GET')).toBe('POST');
        expect(String(reqPath)).toBe("/listings");
        expect(options.headers && options.headers.Authorization).toBe('Bearer test');
    });

    it("updateListing calls PUT /listings/${id}", async () => {
        await listingApi.updateListing(anyArgs).catch(() => {});
        expect(apiFetch).toHaveBeenCalled();
        const [reqPath, options = {}] = apiFetch.mock.calls[apiFetch.mock.calls.length - 1];
        expect(String(options.method || 'GET')).toBe('PUT');
        expect(String(reqPath)).toContain("/listings/");
        expect(options.headers && options.headers.Authorization).toBe('Bearer test');
    });

    it("deleteListing calls DELETE /listings/${id}", async () => {
        await listingApi.deleteListing(anyArgs).catch(() => {});
        expect(apiFetch).toHaveBeenCalled();
        const [reqPath, options = {}] = apiFetch.mock.calls[apiFetch.mock.calls.length - 1];
        expect(String(options.method || 'GET')).toBe('DELETE');
        expect(String(reqPath)).toContain("/listings/");
        expect(options.headers && options.headers.Authorization).toBe('Bearer test');
    });

    it("getHotspots calls GET /listings/hotspots", async () => {
        await listingApi.getHotspots(anyArgs).catch(() => {});
        expect(apiFetch).toHaveBeenCalled();
        const [reqPath, options = {}] = apiFetch.mock.calls[apiFetch.mock.calls.length - 1];
        expect(String(options.method || 'GET')).toBe('GET');
        expect(String(reqPath)).toBe("/listings/hotspots");
    });

    it("markSold calls PATCH /listings/${id}/sold", async () => {
        await listingApi.markSold(anyArgs).catch(() => {});
        expect(apiFetch).toHaveBeenCalled();
        const [reqPath, options = {}] = apiFetch.mock.calls[apiFetch.mock.calls.length - 1];
        expect(String(options.method || 'GET')).toBe('PATCH');
        expect(String(reqPath)).toContain("/listings/");
        expect(String(reqPath)).toContain("/sold");
        expect(options.headers && options.headers.Authorization).toBe('Bearer test');
    });

    it("getMyListings calls GET /listings/my", async () => {
        await listingApi.getMyListings(anyArgs).catch(() => {});
        expect(apiFetch).toHaveBeenCalled();
        const [reqPath, options = {}] = apiFetch.mock.calls[apiFetch.mock.calls.length - 1];
        expect(String(options.method || 'GET')).toBe('GET');
        expect(String(reqPath)).toBe("/listings/my");
        expect(options.headers && options.headers.Authorization).toBe('Bearer test');
    });

    it("getSellerProfile calls GET /listings/seller/${userId}", async () => {
        await listingApi.getSellerProfile(anyArgs).catch(() => {});
        expect(apiFetch).toHaveBeenCalled();
        const [reqPath, options = {}] = apiFetch.mock.calls[apiFetch.mock.calls.length - 1];
        expect(String(options.method || 'GET')).toBe('GET');
        expect(String(reqPath)).toContain("/listings/seller/");
        expect(options.headers && options.headers.Authorization).toBe('Bearer test');
    });

    it("createEscrowIntent calls POST /listings/${id}/escrow/intents", async () => {
        await listingApi.createEscrowIntent(anyArgs).catch(() => {});
        expect(apiFetch).toHaveBeenCalled();
        const [reqPath, options = {}] = apiFetch.mock.calls[apiFetch.mock.calls.length - 1];
        expect(String(options.method || 'GET')).toBe('POST');
        expect(String(reqPath)).toContain("/listings/");
        expect(String(reqPath)).toContain("/escrow/intents");
        expect(options.headers && options.headers.Authorization).toBe('Bearer test');
    });

    it("confirmEscrowIntent calls POST /listings/${id}/escrow/intents/${intentId}/confirm", async () => {
        await listingApi.confirmEscrowIntent(anyArgs).catch(() => {});
        expect(apiFetch).toHaveBeenCalled();
        const [reqPath, options = {}] = apiFetch.mock.calls[apiFetch.mock.calls.length - 1];
        expect(String(options.method || 'GET')).toBe('POST');
        expect(String(reqPath)).toContain("/listings/");
        expect(String(reqPath)).toContain("/escrow/intents/");
        expect(String(reqPath)).toContain("/confirm");
        expect(options.headers && options.headers.Authorization).toBe('Bearer test');
    });

    it("startEscrow calls PATCH /listings/${id}/escrow/start", async () => {
        await listingApi.startEscrow(anyArgs).catch(() => {});
        expect(apiFetch).toHaveBeenCalled();
        const [reqPath, options = {}] = apiFetch.mock.calls[apiFetch.mock.calls.length - 1];
        expect(String(options.method || 'GET')).toBe('PATCH');
        expect(String(reqPath)).toContain("/listings/");
        expect(String(reqPath)).toContain("/escrow/start");
        expect(options.headers && options.headers.Authorization).toBe('Bearer test');
    });

    it("confirmEscrow calls PATCH /listings/${id}/escrow/confirm", async () => {
        await listingApi.confirmEscrow(anyArgs).catch(() => {});
        expect(apiFetch).toHaveBeenCalled();
        const [reqPath, options = {}] = apiFetch.mock.calls[apiFetch.mock.calls.length - 1];
        expect(String(options.method || 'GET')).toBe('PATCH');
        expect(String(reqPath)).toContain("/listings/");
        expect(String(reqPath)).toContain("/escrow/confirm");
        expect(options.headers && options.headers.Authorization).toBe('Bearer test');
    });

    it("cancelEscrow calls PATCH /listings/${id}/escrow/cancel", async () => {
        await listingApi.cancelEscrow(anyArgs).catch(() => {});
        expect(apiFetch).toHaveBeenCalled();
        const [reqPath, options = {}] = apiFetch.mock.calls[apiFetch.mock.calls.length - 1];
        expect(String(options.method || 'GET')).toBe('PATCH');
        expect(String(reqPath)).toContain("/listings/");
        expect(String(reqPath)).toContain("/escrow/cancel");
        expect(options.headers && options.headers.Authorization).toBe('Bearer test');
    });

    it("getMessageInbox calls GET /listings/messages/inbox", async () => {
        await listingApi.getMessageInbox(anyArgs).catch(() => {});
        expect(apiFetch).toHaveBeenCalled();
        const [reqPath, options = {}] = apiFetch.mock.calls[apiFetch.mock.calls.length - 1];
        expect(String(options.method || 'GET')).toBe('GET');
        expect(String(reqPath)).toBe("/listings/messages/inbox");
        expect(options.headers && options.headers.Authorization).toBe('Bearer test');
    });

    it("sendListingMessage calls POST /listings/${id}/messages", async () => {
        await listingApi.sendListingMessage(anyArgs).catch(() => {});
        expect(apiFetch).toHaveBeenCalled();
        const [reqPath, options = {}] = apiFetch.mock.calls[apiFetch.mock.calls.length - 1];
        expect(String(options.method || 'GET')).toBe('POST');
        expect(String(reqPath)).toContain("/listings/");
        expect(String(reqPath)).toContain("/messages");
        expect(options.headers && options.headers.Authorization).toBe('Bearer test');
    });

    it("getListingMessages calls GET /listings/${id}/messages", async () => {
        await listingApi.getListingMessages(anyArgs).catch(() => {});
        expect(apiFetch).toHaveBeenCalled();
        const [reqPath, options = {}] = apiFetch.mock.calls[apiFetch.mock.calls.length - 1];
        expect(String(options.method || 'GET')).toBe('GET');
        expect(String(reqPath)).toContain("/listings/");
        expect(String(reqPath)).toContain("/messages");
        expect(options.headers && options.headers.Authorization).toBe('Bearer test');
    });

    it("startVideoSession calls POST /listings/${id}/video/start", async () => {
        await listingApi.startVideoSession(anyArgs).catch(() => {});
        expect(apiFetch).toHaveBeenCalled();
        const [reqPath, options = {}] = apiFetch.mock.calls[apiFetch.mock.calls.length - 1];
        expect(String(options.method || 'GET')).toBe('POST');
        expect(String(reqPath)).toContain("/listings/");
        expect(String(reqPath)).toContain("/video/start");
        expect(options.headers && options.headers.Authorization).toBe('Bearer test');
    });

    it("joinVideoSession calls POST /listings/${id}/video/join", async () => {
        await listingApi.joinVideoSession(anyArgs).catch(() => {});
        expect(apiFetch).toHaveBeenCalled();
        const [reqPath, options = {}] = apiFetch.mock.calls[apiFetch.mock.calls.length - 1];
        expect(String(options.method || 'GET')).toBe('POST');
        expect(String(reqPath)).toContain("/listings/");
        expect(String(reqPath)).toContain("/video/join");
        expect(options.headers && options.headers.Authorization).toBe('Bearer test');
    });

    it("markVideoSessionConnected calls POST /listings/${id}/video/connected", async () => {
        await listingApi.markVideoSessionConnected(anyArgs).catch(() => {});
        expect(apiFetch).toHaveBeenCalled();
        const [reqPath, options = {}] = apiFetch.mock.calls[apiFetch.mock.calls.length - 1];
        expect(String(options.method || 'GET')).toBe('POST');
        expect(String(reqPath)).toContain("/listings/");
        expect(String(reqPath)).toContain("/video/connected");
        expect(options.headers && options.headers.Authorization).toBe('Bearer test');
    });

    it("endVideoSession calls POST /listings/${id}/video/end", async () => {
        await listingApi.endVideoSession(anyArgs).catch(() => {});
        expect(apiFetch).toHaveBeenCalled();
        const [reqPath, options = {}] = apiFetch.mock.calls[apiFetch.mock.calls.length - 1];
        expect(String(options.method || 'GET')).toBe('POST');
        expect(String(reqPath)).toContain("/listings/");
        expect(String(reqPath)).toContain("/video/end");
        expect(options.headers && options.headers.Authorization).toBe('Bearer test');
    });

});

describe('tradeInApi route contract', () => {
    it("estimate calls POST /trade-in/estimate", async () => {
        await tradeInApi.estimate(anyArgs).catch(() => {});
        expect(apiFetch).toHaveBeenCalled();
        const [reqPath, options = {}] = apiFetch.mock.calls[apiFetch.mock.calls.length - 1];
        expect(String(options.method || 'GET')).toBe('POST');
        expect(String(reqPath)).toBe("/trade-in/estimate");
        expect(options.headers && options.headers.Authorization).toBe('Bearer test');
    });

    it("tradeInEstimate calls POST /trade-in/estimate", async () => {
        await tradeInApi.tradeInEstimate(anyArgs).catch(() => {});
        expect(apiFetch).toHaveBeenCalled();
        const [reqPath, options = {}] = apiFetch.mock.calls[apiFetch.mock.calls.length - 1];
        expect(String(options.method || 'GET')).toBe('POST');
        expect(String(reqPath)).toBe("/trade-in/estimate");
        expect(options.headers && options.headers.Authorization).toBe('Bearer test');
    });

    it("create calls POST /trade-in", async () => {
        await tradeInApi.create(anyArgs).catch(() => {});
        expect(apiFetch).toHaveBeenCalled();
        const [reqPath, options = {}] = apiFetch.mock.calls[apiFetch.mock.calls.length - 1];
        expect(String(options.method || 'GET')).toBe('POST');
        expect(String(reqPath)).toBe("/trade-in");
        expect(options.headers && options.headers.Authorization).toBe('Bearer test');
    });

    it("createTradeIn calls POST /trade-in", async () => {
        await tradeInApi.createTradeIn(anyArgs).catch(() => {});
        expect(apiFetch).toHaveBeenCalled();
        const [reqPath, options = {}] = apiFetch.mock.calls[apiFetch.mock.calls.length - 1];
        expect(String(options.method || 'GET')).toBe('POST');
        expect(String(reqPath)).toBe("/trade-in");
        expect(options.headers && options.headers.Authorization).toBe('Bearer test');
    });

    it("getMyTradeIns calls GET /trade-in/my", async () => {
        await tradeInApi.getMyTradeIns(anyArgs).catch(() => {});
        expect(apiFetch).toHaveBeenCalled();
        const [reqPath, options = {}] = apiFetch.mock.calls[apiFetch.mock.calls.length - 1];
        expect(String(options.method || 'GET')).toBe('GET');
        expect(String(reqPath)).toBe("/trade-in/my");
        expect(options.headers && options.headers.Authorization).toBe('Bearer test');
    });

    it("cancel calls DELETE /trade-in/${id}", async () => {
        await tradeInApi.cancel(anyArgs).catch(() => {});
        expect(apiFetch).toHaveBeenCalled();
        const [reqPath, options = {}] = apiFetch.mock.calls[apiFetch.mock.calls.length - 1];
        expect(String(options.method || 'GET')).toBe('DELETE');
        expect(String(reqPath)).toContain("/trade-in/");
        expect(options.headers && options.headers.Authorization).toBe('Bearer test');
    });

});

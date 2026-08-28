// AUTO-GENERATED route-contract suite for supportApi.js — do not edit by hand.
// Regenerate with: node scripts/generate-api-client-tests.cjs supportApi.js
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
import { supportApi } from './supportApi';

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

describe('supportApi route contract', () => {
    it("createTicket calls POST /support", async () => {
        await supportApi.createTicket(anyArgs).catch(() => {});
        expect(apiFetch).toHaveBeenCalled();
        const [reqPath, options = {}] = apiFetch.mock.calls[apiFetch.mock.calls.length - 1];
        expect(String(options.method || 'GET')).toBe('POST');
        expect(String(reqPath)).toBe("/support");
        expect(options.headers && options.headers.Authorization).toBe('Bearer test');
    });

    it("getTickets calls GET /support", async () => {
        await supportApi.getTickets(anyArgs).catch(() => {});
        expect(apiFetch).toHaveBeenCalled();
        const [reqPath, options = {}] = apiFetch.mock.calls[apiFetch.mock.calls.length - 1];
        expect(String(options.method || 'GET')).toBe('GET');
        expect(String(reqPath)).toBe("/support");
        expect(options.headers && options.headers.Authorization).toBe('Bearer test');
    });

    it("getMessages calls GET /support/${ticketId}/messages", async () => {
        await supportApi.getMessages(anyArgs).catch(() => {});
        expect(apiFetch).toHaveBeenCalled();
        const [reqPath, options = {}] = apiFetch.mock.calls[apiFetch.mock.calls.length - 1];
        expect(String(options.method || 'GET')).toBe('GET');
        expect(String(reqPath)).toContain("/support/");
        expect(String(reqPath)).toContain("/messages");
        expect(options.headers && options.headers.Authorization).toBe('Bearer test');
    });

    it("sendMessage calls POST /support/${ticketId}/messages", async () => {
        await supportApi.sendMessage(anyArgs).catch(() => {});
        expect(apiFetch).toHaveBeenCalled();
        const [reqPath, options = {}] = apiFetch.mock.calls[apiFetch.mock.calls.length - 1];
        expect(String(options.method || 'GET')).toBe('POST');
        expect(String(reqPath)).toContain("/support/");
        expect(String(reqPath)).toContain("/messages");
        expect(options.headers && options.headers.Authorization).toBe('Bearer test');
    });

    it("requestVideoCall calls POST /support/${ticketId}/video/request", async () => {
        await supportApi.requestVideoCall(anyArgs).catch(() => {});
        expect(apiFetch).toHaveBeenCalled();
        const [reqPath, options = {}] = apiFetch.mock.calls[apiFetch.mock.calls.length - 1];
        expect(String(options.method || 'GET')).toBe('POST');
        expect(String(reqPath)).toContain("/support/");
        expect(String(reqPath)).toContain("/video/request");
        expect(options.headers && options.headers.Authorization).toBe('Bearer test');
    });

    it("startVideoSession calls POST /support/${ticketId}/video/start", async () => {
        await supportApi.startVideoSession(anyArgs).catch(() => {});
        expect(apiFetch).toHaveBeenCalled();
        const [reqPath, options = {}] = apiFetch.mock.calls[apiFetch.mock.calls.length - 1];
        expect(String(options.method || 'GET')).toBe('POST');
        expect(String(reqPath)).toContain("/support/");
        expect(String(reqPath)).toContain("/video/start");
        expect(options.headers && options.headers.Authorization).toBe('Bearer test');
    });

    it("joinVideoSession calls POST /support/${ticketId}/video/join", async () => {
        await supportApi.joinVideoSession(anyArgs).catch(() => {});
        expect(apiFetch).toHaveBeenCalled();
        const [reqPath, options = {}] = apiFetch.mock.calls[apiFetch.mock.calls.length - 1];
        expect(String(options.method || 'GET')).toBe('POST');
        expect(String(reqPath)).toContain("/support/");
        expect(String(reqPath)).toContain("/video/join");
        expect(options.headers && options.headers.Authorization).toBe('Bearer test');
    });

    it("markVideoSessionConnected calls POST /support/${ticketId}/video/connected", async () => {
        await supportApi.markVideoSessionConnected(anyArgs).catch(() => {});
        expect(apiFetch).toHaveBeenCalled();
        const [reqPath, options = {}] = apiFetch.mock.calls[apiFetch.mock.calls.length - 1];
        expect(String(options.method || 'GET')).toBe('POST');
        expect(String(reqPath)).toContain("/support/");
        expect(String(reqPath)).toContain("/video/connected");
        expect(options.headers && options.headers.Authorization).toBe('Bearer test');
    });

    it("endVideoSession calls POST /support/${ticketId}/video/end", async () => {
        await supportApi.endVideoSession(anyArgs).catch(() => {});
        expect(apiFetch).toHaveBeenCalled();
        const [reqPath, options = {}] = apiFetch.mock.calls[apiFetch.mock.calls.length - 1];
        expect(String(options.method || 'GET')).toBe('POST');
        expect(String(reqPath)).toContain("/support/");
        expect(String(reqPath)).toContain("/video/end");
        expect(options.headers && options.headers.Authorization).toBe('Bearer test');
    });

    it("adminGetTickets calls GET /support/admin/all", async () => {
        await supportApi.adminGetTickets(anyArgs).catch(() => {});
        expect(apiFetch).toHaveBeenCalled();
        const [reqPath, options = {}] = apiFetch.mock.calls[apiFetch.mock.calls.length - 1];
        expect(String(options.method || 'GET')).toBe('GET');
        expect(String(reqPath)).toBe("/support/admin/all");
        expect(options.headers && options.headers.Authorization).toBe('Bearer test');
    });

    it("adminUpdateStatus calls PATCH /support/${ticketId}/status", async () => {
        await supportApi.adminUpdateStatus(anyArgs).catch(() => {});
        expect(apiFetch).toHaveBeenCalled();
        const [reqPath, options = {}] = apiFetch.mock.calls[apiFetch.mock.calls.length - 1];
        expect(String(options.method || 'GET')).toBe('PATCH');
        expect(String(reqPath)).toContain("/support/");
        expect(String(reqPath)).toContain("/status");
        expect(options.headers && options.headers.Authorization).toBe('Bearer test');
    });

});

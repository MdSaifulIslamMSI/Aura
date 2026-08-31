// AUTO-GENERATED route-contract suite for emergencyApi.js — do not edit by hand.
// Regenerate with: node scripts/generate-api-client-tests.cjs emergencyApi.js
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
import { emergencyApi } from './emergencyApi';

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

describe('emergencyApi route contract', () => {
    it("getStatus calls GET /emergency/status", async () => {
        await emergencyApi.getStatus(anyArgs).catch(() => {});
        expect(apiFetch).toHaveBeenCalled();
        const [reqPath, options = {}] = apiFetch.mock.calls[apiFetch.mock.calls.length - 1];
        expect(String(options.method || 'GET')).toBe('GET');
        expect(String(reqPath)).toBe("/emergency/status");
    });

    it("listAdminControls calls GET /admin/emergency-controls", async () => {
        await emergencyApi.listAdminControls(anyArgs).catch(() => {});
        expect(apiFetch).toHaveBeenCalled();
        const [reqPath, options = {}] = apiFetch.mock.calls[apiFetch.mock.calls.length - 1];
        expect(String(options.method || 'GET')).toBe('GET');
        expect(String(reqPath)).toBe("/admin/emergency-controls");
        expect(options.headers && options.headers.Authorization).toBe('Bearer test');
    });

    it("listAudit calls GET /admin/emergency-controls/audit", async () => {
        await emergencyApi.listAudit(anyArgs).catch(() => {});
        expect(apiFetch).toHaveBeenCalled();
        const [reqPath, options = {}] = apiFetch.mock.calls[apiFetch.mock.calls.length - 1];
        expect(String(options.method || 'GET')).toBe('GET');
        expect(String(reqPath)).toBe("/admin/emergency-controls/audit");
        expect(options.headers && options.headers.Authorization).toBe('Bearer test');
    });

    it("activate calls POST /admin/emergency-controls/${key}/activate", async () => {
        await emergencyApi.activate(anyArgs).catch(() => {});
        expect(apiFetch).toHaveBeenCalled();
        const [reqPath, options = {}] = apiFetch.mock.calls[apiFetch.mock.calls.length - 1];
        expect(String(options.method || 'GET')).toBe('POST');
        expect(String(reqPath)).toContain("/admin/emergency-controls/");
        expect(String(reqPath)).toContain("/activate");
        expect(options.headers && options.headers.Authorization).toBe('Bearer test');
    });

    it("deactivate calls POST /admin/emergency-controls/${key}/deactivate", async () => {
        await emergencyApi.deactivate(anyArgs).catch(() => {});
        expect(apiFetch).toHaveBeenCalled();
        const [reqPath, options = {}] = apiFetch.mock.calls[apiFetch.mock.calls.length - 1];
        expect(String(options.method || 'GET')).toBe('POST');
        expect(String(reqPath)).toContain("/admin/emergency-controls/");
        expect(String(reqPath)).toContain("/deactivate");
        expect(options.headers && options.headers.Authorization).toBe('Bearer test');
    });

    it("extend calls POST /admin/emergency-controls/${key}/extend", async () => {
        await emergencyApi.extend(anyArgs).catch(() => {});
        expect(apiFetch).toHaveBeenCalled();
        const [reqPath, options = {}] = apiFetch.mock.calls[apiFetch.mock.calls.length - 1];
        expect(String(options.method || 'GET')).toBe('POST');
        expect(String(reqPath)).toContain("/admin/emergency-controls/");
        expect(String(reqPath)).toContain("/extend");
        expect(options.headers && options.headers.Authorization).toBe('Bearer test');
    });

    it("updateMessage calls PATCH /admin/emergency-controls/${key}/message", async () => {
        await emergencyApi.updateMessage(anyArgs).catch(() => {});
        expect(apiFetch).toHaveBeenCalled();
        const [reqPath, options = {}] = apiFetch.mock.calls[apiFetch.mock.calls.length - 1];
        expect(String(options.method || 'GET')).toBe('PATCH');
        expect(String(reqPath)).toContain("/admin/emergency-controls/");
        expect(String(reqPath)).toContain("/message");
        expect(options.headers && options.headers.Authorization).toBe('Bearer test');
    });

});

// AUTO-GENERATED route-contract suite for statusApi.js — do not edit by hand.
// Regenerate with: node scripts/generate-api-client-tests.cjs statusApi.js
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
import { statusApi, adminStatusApi } from './statusApi';

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

describe('statusApi route contract', () => {
    it("getPublicStatus calls GET /status/public", async () => {
        await statusApi.getPublicStatus(anyArgs).catch(() => {});
        expect(apiFetch).toHaveBeenCalled();
        const [reqPath, options = {}] = apiFetch.mock.calls[apiFetch.mock.calls.length - 1];
        expect(String(options.method || 'GET')).toBe('GET');
        expect(String(reqPath)).toBe("/status/public");
    });

    it("getHistory calls GET /status/history", async () => {
        await statusApi.getHistory(anyArgs).catch(() => {});
        expect(apiFetch).toHaveBeenCalled();
        const [reqPath, options = {}] = apiFetch.mock.calls[apiFetch.mock.calls.length - 1];
        expect(String(options.method || 'GET')).toBe('GET');
        expect(String(reqPath)).toBe("/status/history");
    });

    it("getIncident calls GET /status/incidents/${encodeURIComponent(String(slug || ''))}", async () => {
        await statusApi.getIncident(anyArgs).catch(() => {});
        expect(apiFetch).toHaveBeenCalled();
        const [reqPath, options = {}] = apiFetch.mock.calls[apiFetch.mock.calls.length - 1];
        expect(String(options.method || 'GET')).toBe('GET');
        expect(String(reqPath)).toContain("/status/incidents/");
    });

    it("subscribe calls POST /status/subscribe", async () => {
        await statusApi.subscribe(anyArgs).catch(() => {});
        expect(apiFetch).toHaveBeenCalled();
        const [reqPath, options = {}] = apiFetch.mock.calls[apiFetch.mock.calls.length - 1];
        expect(String(options.method || 'GET')).toBe('POST');
        expect(String(reqPath)).toBe("/status/subscribe");
    });

    it("unsubscribe calls POST /status/unsubscribe", async () => {
        await statusApi.unsubscribe(anyArgs).catch(() => {});
        expect(apiFetch).toHaveBeenCalled();
        const [reqPath, options = {}] = apiFetch.mock.calls[apiFetch.mock.calls.length - 1];
        expect(String(options.method || 'GET')).toBe('POST');
        expect(String(reqPath)).toBe("/status/unsubscribe");
    });

    it("verify calls GET /status/subscribe/verify", async () => {
        await statusApi.verify(anyArgs).catch(() => {});
        expect(apiFetch).toHaveBeenCalled();
        const [reqPath, options = {}] = apiFetch.mock.calls[apiFetch.mock.calls.length - 1];
        expect(String(options.method || 'GET')).toBe('GET');
        expect(String(reqPath)).toBe("/status/subscribe/verify");
    });

});

describe('adminStatusApi route contract', () => {
    it("getDashboard calls GET /admin/status", async () => {
        await adminStatusApi.getDashboard(anyArgs).catch(() => {});
        expect(apiFetch).toHaveBeenCalled();
        const [reqPath, options = {}] = apiFetch.mock.calls[apiFetch.mock.calls.length - 1];
        expect(String(options.method || 'GET')).toBe('GET');
        expect(String(reqPath)).toBe("/admin/status");
        expect(options.headers && options.headers.Authorization).toBe('Bearer test');
    });

    it("createComponent calls POST /admin/status/components", async () => {
        await adminStatusApi.createComponent(anyArgs).catch(() => {});
        expect(apiFetch).toHaveBeenCalled();
        const [reqPath, options = {}] = apiFetch.mock.calls[apiFetch.mock.calls.length - 1];
        expect(String(options.method || 'GET')).toBe('POST');
        expect(String(reqPath)).toBe("/admin/status/components");
        expect(options.headers && options.headers.Authorization).toBe('Bearer test');
    });

    it("updateComponent calls PATCH /admin/status/components/${encodeURIComponent(String(id))}", async () => {
        await adminStatusApi.updateComponent(anyArgs).catch(() => {});
        expect(apiFetch).toHaveBeenCalled();
        const [reqPath, options = {}] = apiFetch.mock.calls[apiFetch.mock.calls.length - 1];
        expect(String(options.method || 'GET')).toBe('PATCH');
        expect(String(reqPath)).toContain("/admin/status/components/");
        expect(options.headers && options.headers.Authorization).toBe('Bearer test');
    });

    it("createIncident calls POST /admin/status/incidents", async () => {
        await adminStatusApi.createIncident(anyArgs).catch(() => {});
        expect(apiFetch).toHaveBeenCalled();
        const [reqPath, options = {}] = apiFetch.mock.calls[apiFetch.mock.calls.length - 1];
        expect(String(options.method || 'GET')).toBe('POST');
        expect(String(reqPath)).toBe("/admin/status/incidents");
        expect(options.headers && options.headers.Authorization).toBe('Bearer test');
    });

    it("updateIncident calls PATCH /admin/status/incidents/${encodeURIComponent(String(id))}", async () => {
        await adminStatusApi.updateIncident(anyArgs).catch(() => {});
        expect(apiFetch).toHaveBeenCalled();
        const [reqPath, options = {}] = apiFetch.mock.calls[apiFetch.mock.calls.length - 1];
        expect(String(options.method || 'GET')).toBe('PATCH');
        expect(String(reqPath)).toContain("/admin/status/incidents/");
        expect(options.headers && options.headers.Authorization).toBe('Bearer test');
    });

    it("addIncidentUpdate calls POST /admin/status/incidents/${encodeURIComponent(String(id))}/updates", async () => {
        await adminStatusApi.addIncidentUpdate(anyArgs).catch(() => {});
        expect(apiFetch).toHaveBeenCalled();
        const [reqPath, options = {}] = apiFetch.mock.calls[apiFetch.mock.calls.length - 1];
        expect(String(options.method || 'GET')).toBe('POST');
        expect(String(reqPath)).toContain("/admin/status/incidents/");
        expect(String(reqPath)).toContain("/updates");
        expect(options.headers && options.headers.Authorization).toBe('Bearer test');
    });

    it("resolveIncident calls POST /admin/status/incidents/${encodeURIComponent(String(id))}/resolve", async () => {
        await adminStatusApi.resolveIncident(anyArgs).catch(() => {});
        expect(apiFetch).toHaveBeenCalled();
        const [reqPath, options = {}] = apiFetch.mock.calls[apiFetch.mock.calls.length - 1];
        expect(String(options.method || 'GET')).toBe('POST');
        expect(String(reqPath)).toContain("/admin/status/incidents/");
        expect(String(reqPath)).toContain("/resolve");
        expect(options.headers && options.headers.Authorization).toBe('Bearer test');
    });

    it("createMaintenance calls POST /admin/status/maintenance", async () => {
        await adminStatusApi.createMaintenance(anyArgs).catch(() => {});
        expect(apiFetch).toHaveBeenCalled();
        const [reqPath, options = {}] = apiFetch.mock.calls[apiFetch.mock.calls.length - 1];
        expect(String(options.method || 'GET')).toBe('POST');
        expect(String(reqPath)).toBe("/admin/status/maintenance");
        expect(options.headers && options.headers.Authorization).toBe('Bearer test');
    });

    it("generatePostmortem calls POST /admin/status/incidents/${encodeURIComponent(String(id))}/postmortem", async () => {
        await adminStatusApi.generatePostmortem(anyArgs).catch(() => {});
        expect(apiFetch).toHaveBeenCalled();
        const [reqPath, options = {}] = apiFetch.mock.calls[apiFetch.mock.calls.length - 1];
        expect(String(options.method || 'GET')).toBe('POST');
        expect(String(reqPath)).toContain("/admin/status/incidents/");
        expect(String(reqPath)).toContain("/postmortem");
        expect(options.headers && options.headers.Authorization).toBe('Bearer test');
    });

    it("runMonitor calls POST /admin/status/monitor/run", async () => {
        await adminStatusApi.runMonitor(anyArgs).catch(() => {});
        expect(apiFetch).toHaveBeenCalled();
        const [reqPath, options = {}] = apiFetch.mock.calls[apiFetch.mock.calls.length - 1];
        expect(String(options.method || 'GET')).toBe('POST');
        expect(String(reqPath)).toBe("/admin/status/monitor/run");
        expect(options.headers && options.headers.Authorization).toBe('Bearer test');
    });

    it("seedDefaults calls POST /admin/status/seed", async () => {
        await adminStatusApi.seedDefaults(anyArgs).catch(() => {});
        expect(apiFetch).toHaveBeenCalled();
        const [reqPath, options = {}] = apiFetch.mock.calls[apiFetch.mock.calls.length - 1];
        expect(String(options.method || 'GET')).toBe('POST');
        expect(String(reqPath)).toBe("/admin/status/seed");
        expect(options.headers && options.headers.Authorization).toBe('Bearer test');
    });

    it("listSubscribers calls GET /admin/status/subscribers", async () => {
        await adminStatusApi.listSubscribers(anyArgs).catch(() => {});
        expect(apiFetch).toHaveBeenCalled();
        const [reqPath, options = {}] = apiFetch.mock.calls[apiFetch.mock.calls.length - 1];
        expect(String(options.method || 'GET')).toBe('GET');
        expect(String(reqPath)).toBe("/admin/status/subscribers");
        expect(options.headers && options.headers.Authorization).toBe('Bearer test');
    });

    it("listChecks calls GET /admin/status/checks", async () => {
        await adminStatusApi.listChecks(anyArgs).catch(() => {});
        expect(apiFetch).toHaveBeenCalled();
        const [reqPath, options = {}] = apiFetch.mock.calls[apiFetch.mock.calls.length - 1];
        expect(String(options.method || 'GET')).toBe('GET');
        expect(String(reqPath)).toBe("/admin/status/checks");
        expect(options.headers && options.headers.Authorization).toBe('Bearer test');
    });

});

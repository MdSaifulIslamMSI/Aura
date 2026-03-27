import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiFetch, requestWithTrace } from './apiBase';
import { resetActiveMarketHeaders, setActiveMarketHeaders } from './marketRuntime';

describe('apiFetch observability', () => {
    beforeEach(() => {
        window.sessionStorage.clear();
        resetActiveMarketHeaders();
        vi.restoreAllMocks();
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('adds trace headers to API requests', async () => {
        const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
            new Response(JSON.stringify({ ok: true }), {
                status: 200,
                headers: {
                    'Content-Type': 'application/json',
                    'X-Request-Id': 'srv-success',
                },
            })
        );

        await apiFetch('/products', { method: 'GET' });

        expect(fetchMock).toHaveBeenCalledTimes(1);
        const [url, init] = fetchMock.mock.calls[0];
        const headers = new Headers(init?.headers);

        expect(url).toBe('/api/products');
        expect(headers.get('X-Request-Id')).toMatch(/^req-/);
        expect(headers.get('X-Client-Session-Id')).toMatch(/^session-/);
        expect(headers.get('X-Client-Route')).toBe('/');
    });

    it('propagates the active market headers on API requests', async () => {
        setActiveMarketHeaders({
            country: 'US',
            currency: 'USD',
            language: 'es',
        });

        const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
            new Response(JSON.stringify({ ok: true }), {
                status: 200,
                headers: {
                    'Content-Type': 'application/json',
                    'X-Request-Id': 'srv-market',
                },
            })
        );

        await apiFetch('/products', { method: 'GET' });

        const [, init] = fetchMock.mock.calls[0];
        const headers = new Headers(init?.headers);

        expect(headers.get('x-market-country')).toBe('US');
        expect(headers.get('x-market-currency')).toBe('USD');
        expect(headers.get('x-market-language')).toBe('es');
    });

    it('surfaces request ids on API failures', async () => {
        vi.spyOn(globalThis, 'fetch').mockResolvedValue(
            new Response(JSON.stringify({
                message: 'Backend unavailable',
                requestId: 'srv-failure',
            }), {
                status: 503,
                headers: {
                    'Content-Type': 'application/json',
                    'X-Request-Id': 'srv-failure',
                },
            })
        );

        await expect(apiFetch('/products', { retries: 0 })).rejects.toMatchObject({
            status: 503,
            method: 'GET',
            url: '/api/products',
            serverRequestId: 'srv-failure',
            requestId: expect.stringMatching(/^req-/),
        });
    });

    it('can return non-ok responses when auto-throw is disabled', async () => {
        vi.spyOn(globalThis, 'fetch').mockResolvedValue(
            new Response(JSON.stringify({
                status: 'degraded',
                reason: 'database_disconnected',
            }), {
                status: 503,
                headers: {
                    'Content-Type': 'application/json',
                    'X-Request-Id': 'srv-health-degraded',
                },
            })
        );

        const response = await requestWithTrace('/health', {
            method: 'GET',
            throwOnHttpError: false,
        });

        expect(response.status).toBe(503);
        expect(response.headers.get('x-request-id')).toBe('srv-health-degraded');
    });
});

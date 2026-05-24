import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    flushBufferedClientDiagnostics,
    initClientObservability,
    pushClientDiagnostic,
    resetClientObservabilityForTests,
} from './clientObservability';

describe('clientObservability ingestion', () => {
    beforeEach(() => {
        window.sessionStorage.clear();
        vi.restoreAllMocks();
        resetClientObservabilityForTests();
    });

    afterEach(() => {
        resetClientObservabilityForTests();
        vi.restoreAllMocks();
    });

    it('flushes buffered client diagnostics to the backend ingestion endpoint', async () => {
        const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
            new Response(JSON.stringify({ status: 'accepted', accepted: 1 }), {
                status: 202,
                headers: {
                    'Content-Type': 'application/json',
                    'X-Request-Id': 'srv-ingest-1',
                },
            })
        );

        initClientObservability();
        pushClientDiagnostic('api.network_error', {
            url: 'http://127.0.0.1:5173/api/products?page=1',
            method: 'GET',
            requestId: 'req-client-1',
            serverRequestId: 'req-client-1',
            status: 0,
            error: {
                message: 'connect ECONNREFUSED 127.0.0.1:5000',
            },
        }, 'error');

        const flushed = await flushBufferedClientDiagnostics({ force: true });

        expect(flushed).toBe(true);
        expect(fetchMock).toHaveBeenCalledTimes(1);

        const [url, init] = fetchMock.mock.calls[0];
        const payload = JSON.parse(String(init?.body || '{}'));
        const headers = new Headers(init?.headers);

        expect(url).toBe('/api/observability/client-diagnostics');
        expect(headers.get('X-Client-Session-Id')).toMatch(/^session-/);
        expect(payload.events).toHaveLength(1);
        expect(payload.events[0]).toMatchObject({
            type: 'api.network_error',
            requestId: 'req-client-1',
            serverRequestId: 'req-client-1',
            status: 0,
        });
    });

    it('backs off instead of retrying diagnostics when ingestion rejects auth', async () => {
        const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
            new Response(JSON.stringify({ message: 'Unauthorized' }), {
                status: 401,
                headers: {
                    'Content-Type': 'application/json',
                    'X-Request-Id': 'srv-ingest-auth',
                },
            })
        );

        initClientObservability();
        pushClientDiagnostic('api.response_error', {
            url: 'https://aurapilot.vercel.app/api/cart',
            method: 'GET',
            requestId: 'req-client-auth-1',
            serverRequestId: 'srv-cart-1',
            status: 403,
        }, 'warn');

        await expect(flushBufferedClientDiagnostics({ force: true })).resolves.toBe(false);

        pushClientDiagnostic('api.response_error', {
            url: 'https://aurapilot.vercel.app/api/users/wishlist',
            method: 'GET',
            requestId: 'req-client-auth-2',
            serverRequestId: 'srv-wishlist-1',
            status: 403,
        }, 'warn');

        await expect(flushBufferedClientDiagnostics()).resolves.toBe(false);
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiFetch, createResponseError, requestWithTrace } from './apiBase';
import { resetActiveMarketHeaders, setActiveMarketHeaders } from './marketRuntime';
import { ADMIN_ACCESS_LOCK_EVENT } from '../utils/adminAccessLock';

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

    it('preserves bounded auth and device challenge fields on response errors', async () => {
        vi.spyOn(globalThis, 'fetch').mockResolvedValue(
            new Response(JSON.stringify({
                code: 'STEP_UP_REQUIRED',
                feature: 'trusted-device',
                requiresMfa: true,
                requiresStepUpMfa: true,
                requiresPasswordReauth: true,
                step_up_required: true,
                deviceChallenge: { mode: 'assert', availableMethods: ['webauthn'] },
                mfaChallenge: { challengeId: 'challenge-id', allowedMethods: ['totp'] },
                mfaPolicy: { required: true },
                policy: { action: 'admin-sensitive' },
                internalDetail: 'remains available only through data',
            }), {
                status: 403,
                headers: { 'Content-Type': 'application/json' },
            })
        );

        const error = await apiFetch('/admin/sensitive-action', { retries: 0 }).catch((caught) => caught);

        expect(error).toMatchObject({
            status: 403,
            code: 'STEP_UP_REQUIRED',
            feature: 'trusted-device',
            requiresMfa: true,
            requiresStepUpMfa: true,
            requiresPasswordReauth: true,
            step_up_required: true,
            deviceChallenge: { mode: 'assert', availableMethods: ['webauthn'] },
            mfaChallenge: { challengeId: 'challenge-id', allowedMethods: ['totp'] },
            mfaPolicy: { required: true },
            policy: { action: 'admin-sensitive' },
        });
        expect(error).not.toHaveProperty('internalDetail');
        expect(error.data.internalDetail).toBe('remains available only through data');
    });

    it('normalizes Retry-After delta seconds and prefers the response header', async () => {
        const error = await createResponseError(
            new Response(JSON.stringify({ retryAfter: 30 }), {
                status: 429,
                headers: {
                    'Content-Type': 'application/json',
                    'Retry-After': '120',
                },
            })
        );

        expect(error.retryAfterSeconds).toBe(120);
    });

    it('safely handles Retry-After dates, body fallback, caps, and malformed values', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-07-17T12:00:00.000Z'));

        try {
            const datedError = await createResponseError(
                new Response('', {
                    status: 429,
                    headers: { 'Retry-After': 'Fri, 17 Jul 2026 12:01:30 GMT' },
                })
            );
            const fallbackError = await createResponseError(
                new Response(JSON.stringify({ retryAfter: 45 }), {
                    status: 429,
                    headers: {
                        'Content-Type': 'application/json',
                        'Retry-After': 'not-a-retry-date',
                    },
                })
            );
            const cappedError = await createResponseError(
                new Response('', {
                    status: 429,
                    headers: { 'Retry-After': '999999999999' },
                })
            );
            const malformedError = await createResponseError(
                new Response('', {
                    status: 429,
                    headers: { 'Retry-After': '-10' },
                })
            );

            expect(datedError.retryAfterSeconds).toBe(90);
            expect(fallbackError.retryAfterSeconds).toBe(45);
            expect(cappedError.retryAfterSeconds).toBe(86400);
            expect(malformedError).not.toHaveProperty('retryAfterSeconds');
        } finally {
            vi.useRealTimers();
        }
    });

    it('emits one admin access lock event for allowlist lock responses', async () => {
        const lockListener = vi.fn();
        window.addEventListener(ADMIN_ACCESS_LOCK_EVENT, lockListener);
        vi.spyOn(globalThis, 'fetch').mockResolvedValue(
            new Response(JSON.stringify({
                code: 'ADMIN_ALLOWLIST_MISSING',
                message: 'Admin access is locked: allowlist is not configured',
                requestId: 'srv-admin-lock',
            }), {
                status: 403,
                headers: {
                    'Content-Type': 'application/json',
                    'X-Request-Id': 'srv-admin-lock',
                },
            })
        );

        await expect(apiFetch('/admin/dashboard', { retries: 0 })).rejects.toMatchObject({
            status: 403,
            data: expect.objectContaining({
                code: 'ADMIN_ALLOWLIST_MISSING',
            }),
        });

        expect(lockListener).toHaveBeenCalledTimes(1);
        expect(lockListener.mock.calls[0][0].detail).toMatchObject({
            code: 'ADMIN_ALLOWLIST_MISSING',
            reason: 'allowlist_missing',
            requestId: 'srv-admin-lock',
        });
        window.removeEventListener(ADMIN_ACCESS_LOCK_EVENT, lockListener);
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

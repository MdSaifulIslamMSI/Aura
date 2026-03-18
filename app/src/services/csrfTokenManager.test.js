import { beforeEach, describe, expect, it, vi } from 'vitest';

const makeJwt = (sub) => {
    const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
    return `${encode({ alg: 'none', typ: 'JWT' })}.${encode({ sub })}.signature`;
};

const createTokenResponse = (token) => new Response(null, {
    status: 200,
    headers: {
        'X-CSRF-Token': token,
    },
});

describe('csrfTokenManager', () => {
    beforeEach(() => {
        vi.restoreAllMocks();
    });

    it('fetches a fresh API-scoped CSRF token for each reserved write', async () => {
        vi.resetModules();
        const manager = await import('./csrfTokenManager');
        manager.clearCsrfTokenCache();

        const fetchMock = vi.spyOn(globalThis, 'fetch')
            .mockResolvedValueOnce(createTokenResponse('a'.repeat(64)))
            .mockResolvedValueOnce(createTokenResponse('b'.repeat(64)));

        const authToken = makeJwt('user-1');

        await expect(manager.ensureCsrfToken(authToken)).resolves.toBe('a'.repeat(64));
        await expect(manager.ensureCsrfToken(authToken)).resolves.toBe('b'.repeat(64));

        expect(fetchMock).toHaveBeenCalledTimes(2);
        expect(fetchMock.mock.calls[0][0]).toBe('/api/auth/session');
    });

    it('drops cached tokens when the auth owner changes', async () => {
        vi.resetModules();
        const manager = await import('./csrfTokenManager');
        manager.clearCsrfTokenCache();
        manager.cacheToken('c'.repeat(64), 'user-1');

        const fetchMock = vi.spyOn(globalThis, 'fetch')
            .mockResolvedValueOnce(createTokenResponse('d'.repeat(64)));

        await expect(manager.ensureCsrfToken(makeJwt('user-2'))).resolves.toBe('d'.repeat(64));

        expect(fetchMock).toHaveBeenCalledTimes(1);
    });
});

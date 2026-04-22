import { afterEach, describe, expect, it, vi } from 'vitest';

const trustedHeaders = {
    'X-Aura-Device-Id': 'device-123',
    'X-Aura-Device-Label': 'Trusted browser',
};

const loadApiUtils = async ({ isReady = true, currentUser = null } = {}) => {
    vi.resetModules();
    vi.doMock('../../config/firebase', () => ({
        isFirebaseReady: isReady,
        auth: { currentUser },
    }));
    vi.doMock('../deviceTrustClient', () => ({
        getTrustedDeviceHeaders: () => trustedHeaders,
    }));

    return import('./apiUtils');
};

describe('getAuthHeader', () => {
    afterEach(() => {
        vi.restoreAllMocks();
        vi.resetModules();
        vi.doUnmock('../../config/firebase');
        vi.doUnmock('../deviceTrustClient');
    });

    it('uses Firebase bearer proof by default for authenticated app traffic', async () => {
        const currentUser = {
            getIdToken: vi.fn().mockResolvedValue('current-token'),
        };
        const { getAuthHeader } = await loadApiUtils({ currentUser });

        await expect(getAuthHeader()).resolves.toEqual({
            Authorization: 'Bearer current-token',
            ...trustedHeaders,
        });
        expect(currentUser.getIdToken).toHaveBeenCalledWith(false);
    });

    it('keeps explicit cookie-only calls free of Firebase bearer proof', async () => {
        const currentUser = {
            getIdToken: vi.fn().mockResolvedValue('current-token'),
        };
        const { getAuthHeader } = await loadApiUtils({ currentUser });

        await expect(getAuthHeader(null, { useFirebaseBearer: false })).resolves.toEqual(trustedHeaders);
        expect(currentUser.getIdToken).not.toHaveBeenCalled();
    });

    it('uses an explicit Firebase user when provided', async () => {
        const explicitUser = {
            getIdToken: vi.fn().mockResolvedValue('explicit-token'),
        };
        const currentUser = {
            getIdToken: vi.fn().mockResolvedValue('current-token'),
        };
        const { getAuthHeader } = await loadApiUtils({ currentUser });

        await expect(getAuthHeader(explicitUser)).resolves.toEqual({
            Authorization: 'Bearer explicit-token',
            ...trustedHeaders,
        });
        expect(explicitUser.getIdToken).toHaveBeenCalledWith(false);
        expect(currentUser.getIdToken).not.toHaveBeenCalled();
    });

    it('preserves trusted headers when Firebase is not ready', async () => {
        const currentUser = {
            getIdToken: vi.fn().mockResolvedValue('current-token'),
        };
        const { getAuthHeader } = await loadApiUtils({ isReady: false, currentUser });

        await expect(getAuthHeader()).resolves.toEqual(trustedHeaders);
        expect(currentUser.getIdToken).not.toHaveBeenCalled();
    });
});

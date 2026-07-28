import { beforeEach, describe, expect, it, vi } from 'vitest';

const apiFetchMock = vi.hoisted(() => vi.fn());
const getAuthHeaderMock = vi.hoisted(() => vi.fn(async (firebaseUser) => ({
    'x-test-user': firebaseUser?.uid || 'current',
})));

vi.mock('../apiBase', () => ({
    apiFetch: apiFetchMock,
}));

vi.mock('./apiUtils', () => ({
    getAuthHeader: getAuthHeaderMock,
}));

vi.mock('./cartApi', () => ({
    cartApi: {},
    normalizeCartSnapshot: vi.fn((value) => value),
}));

import { userApi } from './userApi';

const deferred = () => {
    let resolve;
    let reject;
    const promise = new Promise((resolvePromise, rejectPromise) => {
        resolve = resolvePromise;
        reject = rejectPromise;
    });
    return { promise, resolve, reject };
};

describe('userApi account caches', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        userApi.clearAccountCache();
    });

    it('deduplicates an overview only within the same authenticated user key', async () => {
        apiFetchMock.mockResolvedValue({
            data: {
                contractVersion: 1,
                identity: { name: 'Owner A' },
            },
        });
        const firebaseUser = { uid: 'owner-a' };

        const [first, second] = await Promise.all([
            userApi.getAccountOverview({ firebaseUser }),
            userApi.getAccountOverview({ firebaseUser }),
        ]);

        expect(first.identity.name).toBe('Owner A');
        expect(second).toBe(first);
        expect(apiFetchMock).toHaveBeenCalledTimes(1);
        expect(apiFetchMock).toHaveBeenCalledWith('/account/summary', {
            headers: { 'x-test-user': 'owner-a' },
        });
    });

    it('never shares an in-flight or cached overview across account switches', async () => {
        const ownerA = deferred();
        const ownerB = deferred();
        apiFetchMock.mockImplementation((_path, options) => {
            const uid = options?.headers?.['x-test-user'];
            return uid === 'owner-a' ? ownerA.promise : ownerB.promise;
        });

        const ownerAPromise = userApi.getAccountOverview({
            firebaseUser: { uid: 'owner-a' },
        });
        const ownerBPromise = userApi.getAccountOverview({
            firebaseUser: { uid: 'owner-b' },
        });

        ownerB.resolve({
            data: {
                contractVersion: 1,
                identity: { name: 'Owner B' },
            },
        });
        expect((await ownerBPromise).identity.name).toBe('Owner B');

        ownerA.resolve({
            data: {
                contractVersion: 1,
                identity: { name: 'Owner A' },
            },
        });
        expect((await ownerAPromise).identity.name).toBe('Owner A');

        const cachedOwnerB = await userApi.getAccountOverview({
            firebaseUser: { uid: 'owner-b' },
        });
        expect(cachedOwnerB.identity.name).toBe('Owner B');
        expect(apiFetchMock).toHaveBeenCalledTimes(2);
    });
});

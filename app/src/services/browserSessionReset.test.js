import { describe, expect, it, vi } from 'vitest';
import {
    clearCacheStorage,
    clearSessionIndexedDb,
    clearStorageArea,
    resetBrowserSessionState,
    unregisterServiceWorkers,
} from './browserSessionReset';

const createFakeStorage = (entries = {}) => {
    const keys = Object.keys(entries);
    return {
        length: keys.length,
        key: (index) => keys[index] ?? null,
        clear: vi.fn(),
        getItem: (key) => entries[key] ?? null,
    };
};

describe('browserSessionReset', () => {
    describe('clearStorageArea', () => {
        it('collects every key before clearing the storage area', () => {
            const storage = createFakeStorage({ token: 'a', theme: 'b' });
            const cleared = clearStorageArea(storage);
            expect(cleared).toEqual(['token', 'theme']);
            expect(storage.clear).toHaveBeenCalledTimes(1);
        });

        it('returns an empty list for a missing storage area', () => {
            expect(clearStorageArea(null)).toEqual([]);
        });

        it('still reports collected keys when clear() throws', () => {
            const storage = createFakeStorage({ keep: '1' });
            storage.clear = vi.fn(() => { throw new Error('quota'); });
            expect(clearStorageArea(storage)).toEqual(['keep']);
        });
    });

    describe('clearCacheStorage', () => {
        it('deletes every cache key and returns them', async () => {
            const cacheKeys = ['/api/one', '/api/two'];
            const cacheStorage = {
                keys: vi.fn(async () => cacheKeys),
                delete: vi.fn(async () => undefined),
            };
            await expect(clearCacheStorage(cacheStorage)).resolves.toEqual(cacheKeys);
            expect(cacheStorage.delete).toHaveBeenCalledWith('/api/one');
            expect(cacheStorage.delete).toHaveBeenCalledWith('/api/two');
        });

        it('tolerates per-key delete failures and skips unusable inputs', async () => {
            const failing = {
                keys: vi.fn(async () => ['/bad']),
                delete: vi.fn(async () => { throw new Error('nope'); }),
            };
            await expect(clearCacheStorage(failing)).resolves.toEqual(['/bad']);
            await expect(clearCacheStorage(null)).resolves.toEqual([]);
            await expect(clearCacheStorage({})).resolves.toEqual([]);
        });
    });

    describe('unregisterServiceWorkers', () => {
        it('unregisters every registration and returns them', async () => {
            const registrations = [
                { unregister: vi.fn(async () => true) },
                { unregister: vi.fn(async () => true) },
            ];
            const container = { getRegistrations: vi.fn(async () => registrations) };
            await expect(unregisterServiceWorkers(container)).resolves.toBe(registrations);
            registrations.forEach((registration) => {
                expect(registration.unregister).toHaveBeenCalledTimes(1);
            });
        });

        it('returns an empty list for missing containers or failed lookups', async () => {
            await expect(unregisterServiceWorkers(null)).resolves.toEqual([]);
            const broken = { getRegistrations: vi.fn(async () => { throw new Error('denied'); }) };
            await expect(unregisterServiceWorkers(broken)).resolves.toEqual([]);
        });
    });

    describe('clearSessionIndexedDb', () => {
        const createIndexedDbRef = ({ discoveredNames = [], succeedNames }) => ({
            databases: vi.fn(async () => discoveredNames.map((name) => ({ name }))),
            deleteDatabase: vi.fn((name) => {
                const request = {};
                queueMicrotask(() => {
                    if (!succeedNames || succeedNames.includes(name)) {
                        request.onsuccess?.();
                    } else {
                        request.onerror?.();
                    }
                });
                return request;
            }),
        });

        it('attempts the known session databases plus discovered aura/firebase ones', async () => {
            const indexedDBRef = createIndexedDbRef({
                discoveredNames: ['aura_market_cache', 'unrelated_db', 'firebase-installations-database'],
            });
            const deleted = await clearSessionIndexedDb(indexedDBRef);

            expect(deleted).toContain('aura_trusted_device_keys');
            expect(deleted).toContain('aura_market_cache');
            expect(deleted).toContain('firebaseLocalStorageDb');
            expect(deleted).not.toContain('unrelated_db');
            expect(indexedDBRef.deleteDatabase).not.toHaveBeenCalledWith('unrelated_db');
        });

        it('keeps only the names that were actually deleted', async () => {
            const indexedDBRef = createIndexedDbRef({ succeedNames: ['aura_trusted_device_keys'] });
            const deleted = await clearSessionIndexedDb(indexedDBRef);
            expect(deleted).toEqual(['aura_trusted_device_keys']);
        });

        it('returns an empty deletion list when indexedDB is unavailable', async () => {
            await expect(clearSessionIndexedDb(null)).resolves.toEqual([]);
        });
    });

    describe('resetBrowserSessionState', () => {
        const createWindowRef = () => {
            const registrations = [{ unregister: vi.fn(async () => true) }];
            return {
                windowRef: {
                    localStorage: createFakeStorage({ aura_token: 'x' }),
                    sessionStorage: createFakeStorage({ aura_temp: 'y' }),
                    caches: {
                        keys: vi.fn(async () => ['/shell']),
                        delete: vi.fn(async () => undefined),
                    },
                    navigator: { serviceWorker: { getRegistrations: vi.fn(async () => registrations) } },
                    indexedDB: {
                        databases: vi.fn(async () => []),
                        deleteDatabase: vi.fn((name) => {
                            const request = {};
                            queueMicrotask(() => request.onsuccess?.());
                            return request;
                        }),
                    },
                },
                registrations,
            };
        };

        it('runs every sign-out step, clears browser state, and redirects', async () => {
            const { windowRef, registrations } = createWindowRef();
            const calls = {
                logoutSession: vi.fn(async () => undefined),
                firebaseSignOut: vi.fn(async () => undefined),
                nativeSignOut: vi.fn(async () => undefined),
                clearRuntimeSession: vi.fn(),
                redirectFn: vi.fn(),
            };

            const result = await resetBrowserSessionState({
                ...calls,
                firebaseAuth: {},
                windowRef,
                redirect: true,
                redirectTo: '/login',
            });

            expect(result.backendLogout).toBe(true);
            expect(result.firebaseSignOut).toBe(true);
            expect(result.nativeSignOut).toBe(true);
            expect(result.clearedLocalStorageKeys).toEqual(['aura_token']);
            expect(result.clearedSessionStorageKeys).toEqual(['aura_temp']);
            expect(result.clearedCacheKeys).toEqual(['/shell']);
            expect(result.unregisteredServiceWorkerCount).toBe(registrations.length);
            expect(result.deletedIndexedDbNames).toContain('aura_trusted_device_keys');
            expect(result.redirectedTo).toBe('/login');
            expect(calls.redirectFn).toHaveBeenCalledWith('/login');
            expect(windowRef.localStorage.clear).toHaveBeenCalled();
        });

        it('continues the reset when a sign-out step fails', async () => {
            const { windowRef } = createWindowRef();
            const failure = new Error('offline');

            const result = await resetBrowserSessionState({
                logoutSession: vi.fn(async () => { throw failure; }),
                firebaseAuth: {},
                firebaseSignOut: vi.fn(async () => { throw failure; }),
                nativeSignOut: vi.fn(async () => { throw failure; }),
                clearRuntimeSession: vi.fn(() => { throw failure; }),
                windowRef,
                redirect: false,
            });

            expect(result.backendLogout).toBe(false);
            expect(result.backendLogoutError).toBe(failure);
            expect(result.firebaseSignOut).toBe(false);
            expect(result.firebaseSignOutError).toBe(failure);
            expect(result.nativeSignOut).toBe(false);
            expect(result.nativeSignOutError).toBe(failure);
            expect(result.clearedLocalStorageKeys).toEqual(['aura_token']);
            expect(result.redirectedTo).toBe('');
        });

        it('skips firebase sign-out when no auth instance is provided', async () => {
            const { windowRef } = createWindowRef();
            const firebaseSignOut = vi.fn(async () => undefined);

            const result = await resetBrowserSessionState({
                firebaseSignOut,
                windowRef,
                redirect: false,
            });

            expect(firebaseSignOut).not.toHaveBeenCalled();
            expect(result.firebaseSignOut).toBe(false);
        });
    });
});

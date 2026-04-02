import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
    GUEST_CART_STORAGE_KEY,
    GUEST_WISHLIST_STORAGE_KEY,
    initializeCommerceSync,
    resetCommerceStoreForTests,
    selectCartSummary,
    useCommerceStore,
} from './commerceStore';
import { userApi } from '../services/api';

const createUserCartState = (overrides = {}) => ({
    itemsById: {},
    orderedIds: [],
    revision: 0,
    status: 'ready',
    source: 'user',
    pendingOps: [],
    lastHydratedAt: Date.now(),
    error: null,
    ...overrides,
});

describe('commerceStore', () => {
    beforeEach(() => {
        localStorage.clear();
        sessionStorage.clear();
        vi.restoreAllMocks();
        resetCommerceStoreForTests();
    });

    it('blocks stale refreshes while optimistic cart ops are pending', async () => {
        const getCartSpy = vi.spyOn(userApi, 'getCart').mockResolvedValue({
            items: [],
            revision: 8,
            syncedAt: null,
        });

        useCommerceStore.setState({
            authUser: { uid: 'user-1', email: 'user@example.com' },
            cart: createUserCartState({
                itemsById: {
                    '42': {
                        id: 42,
                        title: 'Phone',
                        price: 100,
                        originalPrice: 120,
                        discountPercentage: 17,
                        image: '/phone.png',
                        stock: 5,
                        deliveryTime: '2-3 days',
                        quantity: 1,
                    },
                },
                orderedIds: ['42'],
                revision: 7,
                pendingOps: [{ opId: 'op-1', kind: 'set', productId: '42', quantity: 2 }],
                status: 'syncing',
            }),
        });

        const result = await useCommerceStore.getState().refreshIfStale({ force: true });

        expect(getCartSpy).not.toHaveBeenCalled();
        expect(result).toEqual([
            expect.objectContaining({ id: 42, quantity: 1 }),
        ]);
    });

    it('ignores older hydration payloads that resolve after a newer cart add succeeds', async () => {
        let resolveCartSnapshot;
        vi.spyOn(userApi, 'getCart').mockImplementation(() => new Promise((resolve) => {
            resolveCartSnapshot = resolve;
        }));

        const product = {
            id: 73,
            title: 'Race-safe Tablet',
            brand: 'Aura',
            price: 2199,
            originalPrice: 2499,
            discountPercentage: 12,
            image: '/tablet.png',
            stock: 6,
            deliveryTime: '1-2 days',
        };

        vi.spyOn(userApi, 'addCartItem').mockResolvedValue({
            item: {
                ...product,
                quantity: 1,
            },
            revision: 5,
            syncedAt: '2026-04-01T00:30:05.000Z',
        });

        useCommerceStore.setState({
            authUser: { uid: 'user-race', email: 'race@example.com' },
            cart: createUserCartState({
                revision: 4,
                syncedAt: '2026-04-01T00:30:00.000Z',
            }),
        });

        const hydratePromise = useCommerceStore.getState().hydrateCart({ force: true });
        await useCommerceStore.getState().addItem(product, 1);

        resolveCartSnapshot({
            items: [
                {
                    id: 11,
                    title: 'Older Snapshot Headphones',
                    brand: 'Aura',
                    price: 799,
                    originalPrice: 999,
                    discountPercentage: 20,
                    image: '/headphones.png',
                    stock: 3,
                    deliveryTime: '2-3 days',
                    quantity: 1,
                },
            ],
            revision: 4,
            syncedAt: '2026-04-01T00:30:00.000Z',
        });

        await hydratePromise;

        expect(useCommerceStore.getState().cart.orderedIds).toEqual(['73']);
        expect(useCommerceStore.getState().cart.itemsById['73']).toMatchObject({
            id: 73,
            quantity: 1,
            title: 'Race-safe Tablet',
        });
        expect(useCommerceStore.getState().cart.revision).toBe(5);
    });

    it('replays optimistic cart ops after a revision conflict', async () => {
        const product = {
            id: 55,
            title: 'Conflict Laptop',
            brand: 'Aura',
            price: 1499,
            originalPrice: 1699,
            discountPercentage: 12,
            image: '/laptop.png',
            stock: 4,
            deliveryTime: '1-2 days',
        };

        const conflictError = {
            status: 409,
            data: {
                items: [],
                revision: 9,
                syncedAt: null,
            },
        };

        const addCartItemSpy = vi.spyOn(userApi, 'addCartItem')
            .mockRejectedValueOnce(conflictError)
            .mockResolvedValueOnce({
                item: {
                    ...product,
                    quantity: 2,
                },
                revision: 10,
            });

        useCommerceStore.setState({
            authUser: { uid: 'user-2', email: 'user2@example.com' },
            cart: createUserCartState({
                revision: 4,
            }),
        });

        await useCommerceStore.getState().addItem(product, 2);

        expect(addCartItemSpy).toHaveBeenNthCalledWith(1, {
            productId: 55,
            quantity: 2,
            expectedRevision: 4,
        });
        expect(addCartItemSpy).toHaveBeenNthCalledWith(2, {
            productId: 55,
            quantity: 2,
            expectedRevision: 9,
        });

        const cartItems = useCommerceStore.getState().cart.orderedIds
            .map((id) => useCommerceStore.getState().cart.itemsById[id]);

        expect(cartItems).toEqual([
            expect.objectContaining({ id: 55, quantity: 2 }),
        ]);
        expect(useCommerceStore.getState().cart.revision).toBe(10);
        expect(useCommerceStore.getState().cart.pendingOps).toEqual([]);
    });

    it('persists guest cart lines and checkout session intent', async () => {
        const addCartItemSpy = vi.spyOn(userApi, 'addCartItem');
        const product = {
            id: 77,
            title: 'Guest Tablet',
            brand: 'Aura',
            price: 999,
            originalPrice: 1199,
            discountPercentage: 17,
            image: '/tablet.png',
            stock: 8,
            deliveryTime: '2-3 days',
        };

        await useCommerceStore.getState().addItem(product, 1);
        useCommerceStore.getState().startDirectBuy(product, 3);

        expect(addCartItemSpy).not.toHaveBeenCalled();
        expect(localStorage.getItem(GUEST_CART_STORAGE_KEY)).toContain('"id":77');
        expect(sessionStorage.getItem('aura_checkout_session_v1')).toContain('"productId":"77"');

        useCommerceStore.getState().clearDirectBuy();
        expect(sessionStorage.getItem('aura_checkout_session_v1')).toBeNull();
    });

    it('recovers a persisted authenticated cart when the next login session resolves an empty server cart', async () => {
        const recoveredItem = {
            id: 414,
            title: 'Recovered Headphones',
            brand: 'Aura',
            price: 2499,
            originalPrice: 2999,
            discountPercentage: 17,
            image: '/headphones.png',
            stock: 6,
            deliveryTime: '1-2 days',
            quantity: 1,
        };

        useCommerceStore.setState({
            authUser: { uid: 'user-recover', email: 'recover@example.com' },
            cart: createUserCartState({
                itemsById: {
                    '414': recoveredItem,
                },
                orderedIds: ['414'],
                revision: 7,
                syncedAt: '2026-03-30T18:00:00.000Z',
            }),
        });

        await useCommerceStore.getState().bindAuthUser(null);

        vi.spyOn(userApi, 'getCart').mockResolvedValue({
            items: [],
            revision: 0,
            syncedAt: null,
        });
        vi.spyOn(userApi, 'getWishlist').mockResolvedValue({
            items: [],
            revision: 0,
            syncedAt: null,
        });
        const syncCartSpy = vi.spyOn(userApi, 'syncCart').mockResolvedValue({
            items: [recoveredItem],
            revision: 1,
            syncedAt: '2026-03-31T08:15:00.000Z',
        });

        await useCommerceStore.getState().bindAuthUser({ uid: 'user-recover', email: 'recover@example.com' });

        expect(syncCartSpy).toHaveBeenCalledWith(
            [expect.objectContaining({ id: 414, quantity: 1 })],
            { expectedRevision: 0 },
        );
        expect(useCommerceStore.getState().cart.orderedIds).toEqual(['414']);
        expect(useCommerceStore.getState().cart.itemsById['414']).toMatchObject({
            id: 414,
            quantity: 1,
            title: 'Recovered Headphones',
        });
    });

    it('does not force a second hydrate when the same authenticated user is rebound', async () => {
        const recoveredItem = {
            id: 515,
            title: 'Stable Cart Speaker',
            brand: 'Aura',
            price: 3499,
            originalPrice: 3999,
            discountPercentage: 13,
            image: '/speaker.png',
            stock: 4,
            deliveryTime: '1-2 days',
            quantity: 1,
        };

        useCommerceStore.setState({
            authUser: { uid: 'user-stable', email: 'stable@example.com' },
            cart: createUserCartState({
                itemsById: {
                    '515': recoveredItem,
                },
                orderedIds: ['515'],
                revision: 3,
                syncedAt: '2026-03-30T18:00:00.000Z',
            }),
        });

        await useCommerceStore.getState().bindAuthUser(null);

        const getCartSpy = vi.spyOn(userApi, 'getCart').mockResolvedValue({
            items: [],
            revision: 0,
            syncedAt: null,
        });
        const getWishlistSpy = vi.spyOn(userApi, 'getWishlist').mockResolvedValue({
            items: [],
            revision: 0,
            syncedAt: null,
        });
        const syncCartSpy = vi.spyOn(userApi, 'syncCart').mockResolvedValue({
            items: [recoveredItem],
            revision: 1,
            syncedAt: '2026-03-31T08:20:00.000Z',
        });

        await useCommerceStore.getState().bindAuthUser({ uid: 'user-stable', email: 'stable@example.com' });
        await useCommerceStore.getState().bindAuthUser({ uid: 'user-stable', email: 'stable@example.com' });

        expect(getCartSpy).toHaveBeenCalledTimes(1);
        expect(getWishlistSpy).toHaveBeenCalledTimes(1);
        expect(syncCartSpy).toHaveBeenCalledTimes(1);
        expect(useCommerceStore.getState().cart.orderedIds).toEqual(['515']);
    });

    it('recovers a persisted authenticated cart even when the empty server snapshot has a revision', async () => {
        const recoveredItem = {
            id: 616,
            title: 'Recovered Watch',
            brand: 'Aura',
            price: 5999,
            originalPrice: 6999,
            discountPercentage: 14,
            image: '/watch.png',
            stock: 5,
            deliveryTime: '1-2 days',
            quantity: 1,
        };

        useCommerceStore.setState({
            authUser: { uid: 'user-revisioned', email: 'revisioned@example.com' },
            cart: createUserCartState({
                itemsById: {
                    '616': recoveredItem,
                },
                orderedIds: ['616'],
                revision: 4,
                syncedAt: '2026-03-31T18:30:00.000Z',
            }),
        });

        await useCommerceStore.getState().bindAuthUser(null);

        vi.spyOn(userApi, 'getCart').mockResolvedValue({
            items: [],
            revision: 9,
            syncedAt: '2026-04-01T00:15:00.000Z',
        });
        vi.spyOn(userApi, 'getWishlist').mockResolvedValue({
            items: [],
            revision: 0,
            syncedAt: null,
        });
        const syncCartSpy = vi.spyOn(userApi, 'syncCart').mockResolvedValue({
            items: [recoveredItem],
            revision: 10,
            syncedAt: '2026-04-01T00:15:10.000Z',
        });

        await useCommerceStore.getState().bindAuthUser({ uid: 'user-revisioned', email: 'revisioned@example.com' });

        expect(syncCartSpy).toHaveBeenCalledWith(
            [expect.objectContaining({ id: 616, quantity: 1 })],
            { expectedRevision: 9 },
        );
        expect(useCommerceStore.getState().cart.orderedIds).toEqual(['616']);
    });

    it('merges guest wishlist once when the authenticated session hydrates', async () => {
        localStorage.setItem(GUEST_WISHLIST_STORAGE_KEY, JSON.stringify([
            {
                id: 303,
                title: 'Guest Camera',
                price: 799,
                image: '/camera.png',
                brand: 'Aura',
            },
        ]));

        vi.spyOn(userApi, 'getCart').mockResolvedValue({
            items: [],
            revision: 2,
            syncedAt: null,
        });
        vi.spyOn(userApi, 'getWishlist').mockResolvedValue({
            items: [],
            revision: 5,
            syncedAt: null,
        });
        vi.spyOn(userApi, 'mergeCart').mockResolvedValue({
            items: [],
            revision: 2,
            syncedAt: null,
        });
        const mergeWishlistSpy = vi.spyOn(userApi, 'mergeWishlist').mockResolvedValue({
            items: [
                {
                    id: 303,
                    title: 'Guest Camera',
                    price: 799,
                    image: '/camera.png',
                    brand: 'Aura',
                },
            ],
            revision: 6,
            syncedAt: null,
        });

        await useCommerceStore.getState().bindAuthUser({ uid: 'wishlist-user', email: 'wishlist@example.com' });

        expect(mergeWishlistSpy).toHaveBeenCalledWith({
            items: [
                expect.objectContaining({ id: 303 }),
            ],
            expectedRevision: 5,
        });
        expect(useCommerceStore.getState().wishlist.orderedIds).toEqual(['303']);
        expect(localStorage.getItem(GUEST_WISHLIST_STORAGE_KEY)).toBeNull();
    });

    it('ignores stale external user cart snapshots with an older revision', () => {
        useCommerceStore.setState({
            authUser: { uid: 'user-snapshot', email: 'snapshot@example.com' },
            cart: createUserCartState({
                itemsById: {
                    '808': {
                        id: 808,
                        title: 'Fresh Camera',
                        brand: 'Aura',
                        price: 8999,
                        originalPrice: 9999,
                        discountPercentage: 10,
                        image: '/camera.png',
                        stock: 4,
                        deliveryTime: '1-2 days',
                        quantity: 1,
                    },
                },
                orderedIds: ['808'],
                revision: 5,
                syncedAt: '2026-04-01T00:40:00.000Z',
            }),
        });

        useCommerceStore.getState().receiveExternalSnapshot({
            entity: 'cart',
            source: 'user',
            userId: 'user-snapshot',
            items: [],
            revision: 4,
            syncedAt: '2026-04-01T00:39:00.000Z',
        });

        expect(useCommerceStore.getState().cart.orderedIds).toEqual(['808']);
        expect(useCommerceStore.getState().cart.revision).toBe(5);
    });

    it('keeps commerce sync active until the last subscriber releases it', () => {
        const addEventListenerSpy = vi.spyOn(window, 'addEventListener');
        const removeEventListenerSpy = vi.spyOn(window, 'removeEventListener');
        const originalBroadcastChannel = window.BroadcastChannel;
        const closeSpy = vi.fn();

        class FakeBroadcastChannel {
            constructor() {
                this.onmessage = null;
            }

            postMessage() {}

            close() {
                closeSpy();
            }
        }

        Object.defineProperty(window, 'BroadcastChannel', {
            configurable: true,
            writable: true,
            value: FakeBroadcastChannel,
        });

        try {
            const releaseCartSync = initializeCommerceSync();
            const releaseWishlistSync = initializeCommerceSync();

            expect(addEventListenerSpy.mock.calls.filter(([type]) => type === 'storage')).toHaveLength(1);
            expect(addEventListenerSpy.mock.calls.filter(([type]) => type === 'beforeunload')).toHaveLength(1);

            releaseCartSync();

            expect(removeEventListenerSpy.mock.calls.filter(([type]) => type === 'storage')).toHaveLength(0);
            expect(removeEventListenerSpy.mock.calls.filter(([type]) => type === 'beforeunload')).toHaveLength(0);
            expect(closeSpy).not.toHaveBeenCalled();

            releaseWishlistSync();
            releaseWishlistSync();

            expect(removeEventListenerSpy.mock.calls.filter(([type]) => type === 'storage')).toHaveLength(1);
            expect(removeEventListenerSpy.mock.calls.filter(([type]) => type === 'beforeunload')).toHaveLength(1);
            expect(closeSpy).toHaveBeenCalledTimes(1);
        } finally {
            Object.defineProperty(window, 'BroadcastChannel', {
                configurable: true,
                writable: true,
                value: originalBroadcastChannel,
            });
        }
    });

    it('drops stale authenticated sync responses after logout', async () => {
        let resolveAdd;
        vi.spyOn(userApi, 'addCartItem').mockImplementation(() => new Promise((resolve) => {
            resolveAdd = resolve;
        }));

        useCommerceStore.setState({
            authUser: { uid: 'user-9', email: 'user9@example.com' },
            sync: { authGeneration: 1 },
            cart: createUserCartState({
                revision: 3,
            }),
        });

        const addPromise = useCommerceStore.getState().addItem({
            id: 909,
            title: 'Delayed Console',
            price: 499,
            image: '/console.png',
            stock: 3,
        }, 1);

        useCommerceStore.setState({
            authUser: null,
            sync: { authGeneration: 2 },
            cart: {
                ...createUserCartState({
                    source: 'guest',
                    revision: null,
                }),
                pendingOps: [],
            },
        });

        resolveAdd({
            item: {
                id: 909,
                title: 'Delayed Console',
                price: 499,
                image: '/console.png',
                stock: 3,
                quantity: 1,
            },
            revision: 4,
            syncedAt: null,
        });

        await addPromise;

        expect(useCommerceStore.getState().authUser).toBeNull();
        expect(useCommerceStore.getState().cart.source).toBe('guest');
        expect(useCommerceStore.getState().cart.orderedIds).toEqual([]);
    });

    it('starts a fresh authenticated cart hydrate when the auth generation changes mid-request', async () => {
        let resolveUserACart;
        let resolveUserBCart;

        const getCartSpy = vi.spyOn(userApi, 'getCart')
            .mockImplementationOnce(() => new Promise((resolve) => {
                resolveUserACart = resolve;
            }))
            .mockImplementationOnce(() => new Promise((resolve) => {
                resolveUserBCart = resolve;
            }));

        vi.spyOn(userApi, 'getWishlist').mockResolvedValue({
            items: [],
            revision: 0,
            syncedAt: null,
        });

        useCommerceStore.setState({
            authUser: { uid: 'user-a', email: 'user-a@example.com' },
            sync: { authGeneration: 1 },
            cart: createUserCartState({ revision: 2 }),
            wishlist: createUserCartState({ revision: 1 }),
        });

        const staleHydratePromise = useCommerceStore.getState().hydrateCart({ force: true });
        const reboundPromise = useCommerceStore.getState().bindAuthUser({ uid: 'user-b', email: 'user-b@example.com' });

        expect(getCartSpy).toHaveBeenCalledTimes(2);

        resolveUserBCart({
            items: [
                {
                    id: 222,
                    title: 'Fresh Session Speaker',
                    brand: 'Aura',
                    price: 3499,
                    originalPrice: 3999,
                    discountPercentage: 13,
                    image: '/speaker.png',
                    stock: 4,
                    deliveryTime: '1-2 days',
                    quantity: 1,
                },
            ],
            revision: 9,
            syncedAt: '2026-04-01T01:00:10.000Z',
        });

        await reboundPromise;

        expect(useCommerceStore.getState().authUser).toMatchObject({ uid: 'user-b' });
        expect(useCommerceStore.getState().cart.orderedIds).toEqual(['222']);

        resolveUserACart({
            items: [
                {
                    id: 111,
                    title: 'Stale Session Camera',
                    brand: 'Aura',
                    price: 8999,
                    originalPrice: 9999,
                    discountPercentage: 10,
                    image: '/camera.png',
                    stock: 3,
                    deliveryTime: '2-3 days',
                    quantity: 1,
                },
            ],
            revision: 3,
            syncedAt: '2026-04-01T01:00:00.000Z',
        });

        await staleHydratePromise;

        expect(useCommerceStore.getState().authUser).toMatchObject({ uid: 'user-b' });
        expect(useCommerceStore.getState().cart.orderedIds).toEqual(['222']);
        expect(useCommerceStore.getState().cart.revision).toBe(9);
    });

    it('starts a fresh cart flush when a new auth generation enqueues work during an older flush', async () => {
        let resolveUserAAdd;
        let resolveUserBAdd;

        const addCartItemSpy = vi.spyOn(userApi, 'addCartItem')
            .mockImplementationOnce(() => new Promise((resolve) => {
                resolveUserAAdd = resolve;
            }))
            .mockImplementationOnce(() => new Promise((resolve) => {
                resolveUserBAdd = resolve;
            }));

        useCommerceStore.setState({
            authUser: { uid: 'user-a', email: 'user-a@example.com' },
            sync: { authGeneration: 1 },
            cart: createUserCartState({ revision: 3 }),
        });

        const staleAddPromise = useCommerceStore.getState().addItem({
            id: 101,
            title: 'User A Console',
            price: 499,
            image: '/console.png',
            stock: 3,
        }, 1);

        useCommerceStore.setState({
            authUser: { uid: 'user-b', email: 'user-b@example.com' },
            sync: { authGeneration: 2 },
            cart: createUserCartState({ revision: 8 }),
        });

        const reboundAddPromise = useCommerceStore.getState().addItem({
            id: 202,
            title: 'User B Laptop',
            price: 1499,
            image: '/laptop.png',
            stock: 5,
        }, 1);

        expect(addCartItemSpy).toHaveBeenCalledTimes(2);
        expect(addCartItemSpy).toHaveBeenNthCalledWith(2, {
            productId: 202,
            quantity: 1,
            expectedRevision: 8,
        });

        resolveUserBAdd({
            item: {
                id: 202,
                title: 'User B Laptop',
                price: 1499,
                image: '/laptop.png',
                stock: 5,
                quantity: 1,
            },
            revision: 9,
            syncedAt: '2026-04-01T01:05:10.000Z',
        });

        await reboundAddPromise;

        expect(useCommerceStore.getState().authUser).toMatchObject({ uid: 'user-b' });
        expect(useCommerceStore.getState().cart.orderedIds).toEqual(['202']);

        resolveUserAAdd({
            item: {
                id: 101,
                title: 'User A Console',
                price: 499,
                image: '/console.png',
                stock: 3,
                quantity: 1,
            },
            revision: 4,
            syncedAt: '2026-04-01T01:05:00.000Z',
        });

        await staleAddPromise;

        expect(useCommerceStore.getState().authUser).toMatchObject({ uid: 'user-b' });
        expect(useCommerceStore.getState().cart.orderedIds).toEqual(['202']);
        expect(useCommerceStore.getState().cart.revision).toBe(9);
        expect(useCommerceStore.getState().cart.pendingOps).toEqual([]);
    });

    it('preserves newer same-product optimistic quantity updates while an older cart commit resolves', async () => {
        let resolveFirstQuantityUpdate;
        let resolveSecondQuantityUpdate;

        vi.spyOn(userApi, 'setCartItemQuantity')
            .mockImplementationOnce(() => new Promise((resolve) => {
                resolveFirstQuantityUpdate = resolve;
            }))
            .mockImplementationOnce(() => new Promise((resolve) => {
                resolveSecondQuantityUpdate = resolve;
            }));

        useCommerceStore.setState({
            authUser: { uid: 'user-qty', email: 'qty@example.com' },
            cart: createUserCartState({
                revision: 7,
                itemsById: {
                    '42': {
                        id: 42,
                        title: 'Race-safe Phone',
                        brand: 'Aura',
                        price: 899,
                        originalPrice: 999,
                        discountPercentage: 10,
                        image: '/phone.png',
                        stock: 5,
                        deliveryTime: '1-2 days',
                        quantity: 1,
                    },
                },
                orderedIds: ['42'],
            }),
        });

        const firstFlushPromise = useCommerceStore.getState().setQuantity(42, 2);
        const secondFlushPromise = useCommerceStore.getState().setQuantity(42, 3);

        resolveFirstQuantityUpdate({
            item: {
                id: 42,
                title: 'Race-safe Phone',
                brand: 'Aura',
                price: 899,
                originalPrice: 999,
                discountPercentage: 10,
                image: '/phone.png',
                stock: 5,
                deliveryTime: '1-2 days',
                quantity: 2,
            },
            revision: 8,
            syncedAt: '2026-04-01T01:10:05.000Z',
        });

        await vi.waitFor(() => {
            expect(useCommerceStore.getState().cart.itemsById['42']).toMatchObject({
                id: 42,
                quantity: 3,
            });
            expect(useCommerceStore.getState().cart.pendingOps).toHaveLength(1);
        });

        resolveSecondQuantityUpdate({
            item: {
                id: 42,
                title: 'Race-safe Phone',
                brand: 'Aura',
                price: 899,
                originalPrice: 999,
                discountPercentage: 10,
                image: '/phone.png',
                stock: 5,
                deliveryTime: '1-2 days',
                quantity: 3,
            },
            revision: 9,
            syncedAt: '2026-04-01T01:10:10.000Z',
        });

        await firstFlushPromise;
        await secondFlushPromise;

        expect(useCommerceStore.getState().cart.itemsById['42']).toMatchObject({
            id: 42,
            quantity: 3,
        });
        expect(useCommerceStore.getState().cart.revision).toBe(9);
        expect(useCommerceStore.getState().cart.pendingOps).toEqual([]);
    });

    it('builds cart totals from backend-authoritative display pricing', () => {
        useCommerceStore.setState({
            cart: createUserCartState({
                itemsById: {
                    '808': {
                        id: 808,
                        title: 'Global Camera',
                        price: 10000,
                        originalPrice: 12000,
                        quantity: 2,
                        pricing: {
                            baseAmount: 10000,
                            baseCurrency: 'INR',
                            displayAmount: 135,
                            displayCurrency: 'USD',
                            originalDisplayAmount: 150,
                        },
                    },
                },
                orderedIds: ['808'],
                source: 'guest',
            }),
        });

        const summary = selectCartSummary(useCommerceStore.getState());

        expect(summary.totalPrice).toBe(270);
        expect(summary.totalOriginalPrice).toBe(300);
        expect(summary.totalDiscount).toBe(30);
        expect(summary.currency).toBe('USD');
    });
});

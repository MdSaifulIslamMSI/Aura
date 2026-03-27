import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
    GUEST_CART_STORAGE_KEY,
    GUEST_WISHLIST_STORAGE_KEY,
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

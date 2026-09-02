import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
    GUEST_CART_STORAGE_KEY,
    GUEST_WISHLIST_STORAGE_KEY,
    resetCommerceStoreForTests,
    selectCartItems,
    selectCartLoading,
    selectCartSummary,
    selectWishlistCount,
    selectWishlistItems,
    useCommerceStore,
} from './commerceStore.runtime';

vi.mock('../services/clientObservability', () => ({
    pushClientDiagnostic: vi.fn(),
}));

const sampleProduct = {
    id: 42,
    title: 'Aura Phone',
    price: 19999,
    originalPrice: 24999,
    discountPercentage: 20,
    image: '/phone.png',
    stock: 5,
    deliveryTime: '2-3 days',
};

describe('commerceStore.runtime (guest mode)', () => {
    beforeEach(() => {
        localStorage.clear();
        sessionStorage.clear();
        vi.restoreAllMocks();
        resetCommerceStoreForTests();
    });

    it('starts as an empty guest cart and wishlist with a clean checkout session', () => {
        const state = useCommerceStore.getState();

        expect(state.authUser).toBeNull();
        expect(state.cart).toMatchObject({ itemsById: {}, orderedIds: [], source: 'guest', revision: null, status: 'idle' });
        expect(state.wishlist).toMatchObject({ itemsById: {}, source: 'guest' });
        expect(state.checkoutSession).toEqual({ source: 'cart', directBuy: null });
        expect(selectCartItems(useCommerceStore.getState())).toEqual([]);
        // An empty, idle guest cart is reported as "loading" by the selector.
        expect(selectCartLoading(useCommerceStore.getState())).toBe(true);
    });

    it('adds valid products to the guest cart and persists the snapshot', async () => {
        await useCommerceStore.getState().addItem(sampleProduct);

        const items = selectCartItems(useCommerceStore.getState());
        expect(items).toHaveLength(1);
        expect(items[0]).toMatchObject({ id: 42, title: 'Aura Phone', price: 19999, quantity: 1 });

        const persisted = JSON.parse(localStorage.getItem(GUEST_CART_STORAGE_KEY));
        expect(persisted.map((entry) => entry.id)).toEqual([42]);
    });

    it('merges repeated adds of the same product into quantity', async () => {
        await useCommerceStore.getState().addItem(sampleProduct);
        await useCommerceStore.getState().addItem(sampleProduct);

        const items = selectCartItems(useCommerceStore.getState());
        expect(items).toHaveLength(1);
        expect(items[0].quantity).toBe(2);
    });

    it('rejects products that cannot become a valid cart line', async () => {
        const result = await useCommerceStore.getState().addItem({ title: 'No id' });

        expect(result).toEqual([]);
        expect(selectCartItems(useCommerceStore.getState())).toEqual([]);
    });

    it('updates and removes cart lines', async () => {
        await useCommerceStore.getState().addItem(sampleProduct);

        await useCommerceStore.getState().setQuantity(42, 3);
        expect(selectCartItems(useCommerceStore.getState())[0].quantity).toBe(3);

        await useCommerceStore.getState().removeItem(42);
        expect(selectCartItems(useCommerceStore.getState())).toEqual([]);
        // Empty guest snapshots purge the storage key entirely.
        expect(localStorage.getItem(GUEST_CART_STORAGE_KEY)).toBeNull();
    });

    it('summarizes the cart for selectors', async () => {
        await useCommerceStore.getState().addItem(sampleProduct, 2);

        const summary = selectCartSummary(useCommerceStore.getState());
        expect(summary.totalItems).toBe(2);
        expect(summary.itemCount).toBe(1);
        expect(summary.totalPrice).toBe(19999 * 2);
        expect(summary.totalDiscount).toBe((24999 - 19999) * 2);
        expect(summary.currency).toBe('INR');
    });

    it('adds wishlist items and toggles them off', async () => {
        const added = await useCommerceStore.getState().toggleWishlistItem(sampleProduct);
        expect(added).toBe(true);
        expect(selectWishlistItems(useCommerceStore.getState())).toHaveLength(1);
        expect(selectWishlistCount(useCommerceStore.getState())).toBe(1);
        expect(JSON.parse(localStorage.getItem(GUEST_WISHLIST_STORAGE_KEY))).toHaveLength(1);

        const removed = await useCommerceStore.getState().toggleWishlistItem(sampleProduct);
        expect(removed).toBe(false);
        expect(selectWishlistItems(useCommerceStore.getState())).toEqual([]);
    });

    it('clears the guest cart in memory and in storage', async () => {
        await useCommerceStore.getState().addItem(sampleProduct);

        useCommerceStore.getState().clearCart();

        expect(selectCartItems(useCommerceStore.getState())).toEqual([]);
        // Empty guest snapshots purge the storage key entirely.
        expect(localStorage.getItem(GUEST_CART_STORAGE_KEY)).toBeNull();
        expect(useCommerceStore.getState().cart.status).toBe('ready');
    });

    it('replaces the cart snapshot from a broadcast payload', () => {
        const result = useCommerceStore.getState().replaceCartSnapshot(
            { items: [{ ...sampleProduct, quantity: 4 }] },
            { source: 'guest' },
        );

        expect(result).toHaveLength(1);
        expect(selectCartItems(useCommerceStore.getState())[0].quantity).toBe(4);
        expect(JSON.parse(localStorage.getItem(GUEST_CART_STORAGE_KEY))).toHaveLength(1);
    });

    it('starts a direct-buy checkout session and clears it again', () => {
        useCommerceStore.getState().startDirectBuy(sampleProduct, 2);

        const session = useCommerceStore.getState().checkoutSession;
        expect(session.source).toBe('direct-buy');
        expect(session.directBuy).toMatchObject({ productId: '42', quantity: 2 });

        useCommerceStore.getState().clearDirectBuy();
        expect(useCommerceStore.getState().checkoutSession).toEqual({ source: 'cart', directBuy: null });
    });

    it('ignores direct buys for invalid products', () => {
        useCommerceStore.getState().startDirectBuy({ title: 'No id' });
        expect(useCommerceStore.getState().checkoutSession.source).toBe('cart');
    });
});

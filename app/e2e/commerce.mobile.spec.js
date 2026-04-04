import { test, expect } from '@playwright/test';
import {
    createGuestCartItem,
    createGuestWishlistItem,
    mockProductDetailApis,
    seedGuestCommerceState,
    waitForAppShell,
} from './support/commerceState.js';

test.describe('Mobile Commerce Parity', () => {
    test('guest wishlist stays touch-usable and moves items into the bag', async ({ page }) => {
        const wishlistItem = createGuestWishlistItem({
            id: 910101,
            title: 'Aura Pulse Buds Pro',
        });

        await seedGuestCommerceState(page, {
            wishlistItems: [wishlistItem],
        });

        await waitForAppShell(page, '/wishlist');

        const moveToBag = page.getByRole('button', { name: /^add to bag$/i }).last();

        await expect(page).toHaveURL(/\/wishlist$/);
        await expect(page.getByRole('heading', { name: /saved items/i })).toBeVisible();
        await expect(moveToBag).toBeVisible();
        await expect(page.getByRole('button', { name: /remove .* from wishlist/i })).toBeVisible();

        await moveToBag.click();

        await expect(page.getByText(/your wishlist is empty/i)).toBeVisible({ timeout: 10_000 });
        await expect.poll(async () => page.evaluate((storageKey) => {
            const snapshot = window.localStorage.getItem(storageKey);
            return Array.isArray(JSON.parse(snapshot || '[]')) ? JSON.parse(snapshot || '[]').length : 0;
        }, 'aura_cart_guest_v2')).toBe(1);

        await page.goto('/cart');
        await expect(page.getByRole('heading', { name: /your bag/i })).toBeVisible();
        await expect(page.getByText(wishlistItem.title)).toBeVisible();
    });

    test('mobile cart counter and quantity controls stay synchronized from guest state', async ({ page }) => {
        const cartItem = createGuestCartItem({
            id: 810101,
            title: 'Aura Flux Phone Max',
            quantity: 2,
        });

        await seedGuestCommerceState(page, {
            cartItems: [cartItem],
        });

        await waitForAppShell(page, '/');

        await page.getByRole('button', { name: /toggle menu/i }).click();
        await expect(page.getByRole('link', { name: /cart \(2\)/i })).toBeVisible();

        await page.goto('/cart');
        await expect(page.getByRole('heading', { name: /your bag/i })).toBeVisible();
        await expect(page.getByText(cartItem.title)).toBeVisible();

        const increaseQuantity = page.getByRole('button', {
            name: new RegExp(`increase quantity for ${cartItem.title}`, 'i'),
        });

        await expect(increaseQuantity).toBeVisible();
        await increaseQuantity.click();

        await page.getByRole('button', { name: /toggle menu/i }).click();
        await expect(page.getByRole('link', { name: /cart \(3\)/i })).toBeVisible();
    });

    test('mobile PDP sticky actions use the centralized flow and protect guest checkout', async ({ page }) => {
        const product = await mockProductDetailApis(page, {
            productId: 990001,
            product: {
                title: 'Aura Flux Phone Max',
                displayTitle: 'Aura Flux Phone Max',
            },
        });

        await seedGuestCommerceState(page);
        await waitForAppShell(page, `/product/${product.id}`);

        const addToBag = page.getByRole('button', { name: /^add to bag$/i }).first();
        const buyNow = page.getByRole('button', { name: /^buy now$/i }).first();

        await expect(addToBag).toBeVisible();
        await expect(buyNow).toBeVisible();

        await addToBag.click();

        await expect(page.getByRole('button', {
            name: new RegExp(`increase quantity for ${product.title}`, 'i'),
        }).first()).toBeVisible();

        await buyNow.click();
        await page.waitForURL(/\/login/, { timeout: 10_000 });
        await expect(page.url()).toContain('/login');
    });
});

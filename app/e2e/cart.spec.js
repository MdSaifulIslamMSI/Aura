import { test, expect } from '@playwright/test';

/**
 * e2e/cart.spec.js — Cart page smoke tests.
 */
test.describe('Cart Page', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('/cart');
    });

    test('loads without full-page crash', async ({ page }) => {
        await expect(page.getByText('Something went wrong')).toHaveCount(0, { timeout: 10_000 });
    });

    test('renders main content area', async ({ page }) => {
        await expect(page.locator('main')).toBeVisible({ timeout: 10_000 });
    });

    test('shows empty state, loader, or cart items', async ({ page }) => {
        const hasContent = await Promise.any([
            page.getByText(/couldn't find any items/i).waitFor({ state: 'visible', timeout: 10_000 }),
            page.getByText(/syncing your latest cart/i).waitFor({ state: 'visible', timeout: 5_000 }),
            page.locator('.cart-quantity-control').first().waitFor({ state: 'visible', timeout: 10_000 }),
        ]).then(() => true).catch(() => false);
        expect(hasContent).toBe(true);
    });
});

import { test, expect } from '@playwright/test';

/**
 * e2e/wishlist.spec.js — Wishlist page smoke tests.
 */
test.describe('Wishlist Page', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('/wishlist');
    });

    test('loads without full-page crash', async ({ page }) => {
        await expect(page.getByText('Something went wrong')).toHaveCount(0, { timeout: 10_000 });
    });

    test('renders main content area', async ({ page }) => {
        await expect(page.locator('main')).toBeVisible({ timeout: 10_000 });
    });

    test('shows empty state or saved items', async ({ page }) => {
        const hasContent = await Promise.any([
            page.getByText(/wishlist is empty/i).waitFor({ state: 'visible', timeout: 10_000 }),
            page.locator('[data-testid^="wish-card-"], [data-testid="product-card"]').first().waitFor({ state: 'visible', timeout: 10_000 }),
        ]).then(() => true).catch(() => false);
        expect(hasContent).toBe(true);
    });
});

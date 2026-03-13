import { test, expect } from '@playwright/test';

/**
 * e2e/product.spec.js — Product listing and product detail smoke tests.
 */
test.describe('Product Listing Page', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('/products');
    });

    test('loads without full-page crash', async ({ page }) => {
        await expect(page.getByText('Something went wrong')).toHaveCount(0, { timeout: 10_000 });
    });

    test('page renders main content area', async ({ page }) => {
        await expect(page.locator('main')).toBeVisible({ timeout: 10_000 });
    });

    test('product cards or skeletons appear', async ({ page }) => {
        // Either real product cards, OR skeletons (animate-pulse elements) should be present
        const hasContent = await Promise.race([
            page.locator('[data-testid="product-card"]').first().waitFor({ state: 'visible', timeout: 8_000 }).then(() => true).catch(() => false),
            page.locator('.animate-pulse').first().waitFor({ state: 'visible', timeout: 5_000 }).then(() => true).catch(() => false),
        ]);
        expect(hasContent).toBe(true);
    });
});

test.describe('Product Detail Page', () => {
    test('loads product detail page or shows skeleton/not-found', async ({ page }) => {
        // Navigate to a product ID — may 404 in test env, but must not crash the app
        await page.goto('/product/1');
        // Either skeleton, not-found state, or actual product — no crash
        await expect(page.getByText('Something went wrong')).toHaveCount(0, { timeout: 10_000 });
        await expect(page.locator('main')).toBeVisible();
    });

    test('back navigation works from product page', async ({ page }) => {
        await page.goto('/product/1');
        const productUrl = page.url();
        await page.goBack();
        await page.waitForURL((url) => url.toString() !== productUrl, { timeout: 5000 });
        expect(page.url()).not.toContain('/product/1');
    });
});

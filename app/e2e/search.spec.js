import { test, expect } from '@playwright/test';

/**
 * e2e/search.spec.js — Search results smoke tests.
 */
test.describe('Search Page', () => {
    test('query renders results, skeletons, or no-results state', async ({ page }) => {
        await page.goto('/search?q=phone');
        await expect(page.getByText('Something went wrong')).toHaveCount(0, { timeout: 10_000 });
        const hasContent = await Promise.any([
            page.locator('[data-testid="product-card"]').first().waitFor({ state: 'visible', timeout: 10_000 }),
            page.locator('.animate-pulse').first().waitFor({ state: 'visible', timeout: 5_000 }),
            page.getByText(/no matching products|no results/i).waitFor({ state: 'visible', timeout: 10_000 }),
        ]).then(() => true).catch(() => false);
        expect(hasContent).toBe(true);
    });

    test('bare search route loads without crash', async ({ page }) => {
        await page.goto('/search');
        await expect(page.getByText('Something went wrong')).toHaveCount(0, { timeout: 10_000 });
        await expect(page.locator('main')).toBeVisible({ timeout: 10_000 });
    });
});

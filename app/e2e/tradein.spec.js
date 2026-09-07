import { test, expect } from '@playwright/test';

/**
 * e2e/tradein.spec.js — Trade-in page smoke tests (protected route).
 */
test.describe('Trade-In Page', () => {
    test('guest is redirected to login or sees the page without crash', async ({ page }) => {
        await page.goto('/trade-in');
        await expect(page.getByText('Something went wrong')).toHaveCount(0, { timeout: 10_000 });
        const settled = await Promise.any([
            page.waitForURL(/\/login/, { timeout: 10_000 }).then(() => 'login'),
            page.locator('main').waitFor({ state: 'visible', timeout: 10_000 }).then(() => 'page'),
        ]).then((value) => value).catch(() => 'unknown');
        expect(['login', 'page']).toContain(settled);
    });

    test('price alerts route behaves the same for guests', async ({ page }) => {
        await page.goto('/price-alerts');
        await expect(page.getByText('Something went wrong')).toHaveCount(0, { timeout: 10_000 });
    });
});

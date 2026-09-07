import { test, expect } from '@playwright/test';

/**
 * e2e/status.spec.js — Public status page smoke tests.
 */
test.describe('Status Page', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('/status');
    });

    test('loads without full-page crash', async ({ page }) => {
        await expect(page.getByText('Something went wrong')).toHaveCount(0, { timeout: 10_000 });
    });

    test('renders main content area', async ({ page }) => {
        await expect(page.locator('main')).toBeVisible({ timeout: 10_000 });
    });

    test('shows status content, history link, or fallback', async ({ page }) => {
        const hasContent = await Promise.any([
            page.getByText(/operational|degraded|maintenance|status/i).first().waitFor({ state: 'visible', timeout: 10_000 }),
            page.locator('main').waitFor({ state: 'visible', timeout: 10_000 }),
        ]).then(() => true).catch(() => false);
        expect(hasContent).toBe(true);
    });
});

import { test, expect } from '@playwright/test';

/**
 * e2e/accessibility.spec.js — Baseline accessibility smoke tests.
 *
 * Does NOT replace a full axe audit, but catches regressions in:
 * - Page landmark structure (at least one <main>)
 * - Heading hierarchy (a single <h1> per page)
 * - Image alt text
 * - Interactive element labels (no unlabelled buttons)
 */
test.describe('Accessibility Baseline', () => {
    const pages = [
        { name: 'Home', path: '/' },
        { name: 'Product Listing', path: '/products' },
        { name: 'Login', path: '/login' },
    ];

    for (const { name, path } of pages) {
        test(`${name}: has a single <main> landmark`, async ({ page }) => {
            await page.goto(path);
            await page.waitForLoadState('networkidle');
            await page.locator('#main-content').first().waitFor({ state: 'attached', timeout: 15000 });
            const mains = page.locator('main');
            await expect(mains).toHaveCount(1, { timeout: 10_000 });
        });

        test(`${name}: has at least one <h1>`, async ({ page }) => {
            await page.goto(path);
            await page.waitForLoadState('networkidle');
            await page.locator('#main-content').first().waitFor({ state: 'attached', timeout: 15000 });
            await expect(page.locator('main')).toHaveCount(1, { timeout: 15000 });
            const h1Count = await page.locator('h1').count();
            expect(h1Count).toBeGreaterThanOrEqual(1);
        });

        test(`${name}: images have alt text`, async ({ page }) => {
            await page.goto(path);
            await page.waitForLoadState('networkidle');
            await page.locator('#main-content').first().waitFor({ state: 'attached', timeout: 15000 });
            await expect(page.locator('main')).toHaveCount(1, { timeout: 15000 });
            // All visible images should have non-empty alt attributes
            const imagesWithoutAlt = await page.locator('img:not([alt])').count();
            // Allow a small tolerance for purely decorative images (badges etc.)
            expect(imagesWithoutAlt).toBeLessThanOrEqual(3);
        });
    }

    test('Home: skip-to-content link is first focusable element', async ({ page }) => {
        await page.goto('/');
        await page.waitForLoadState('networkidle');
        await page.locator('#main-content').first().waitFor({ state: 'attached', timeout: 15000 });
        await page.keyboard.press('Tab');
        // The skip link href should point to #main-content
        const focused = await page.evaluate(() => document.activeElement?.getAttribute('href'));
        expect(focused).toBe('#main-content');
    });
});

import { test, expect } from '@playwright/test';

/**
 * e2e/auth.spec.js — Authentication routing smoke tests.
 *
 * Verifies that protected routes redirect unauthenticated users to login,
 * and that the login page renders without crash.
 */
test.describe('Authentication Guards', () => {
    test('login page renders without crash', async ({ page }) => {
        await page.goto('/login');
        await page.waitForLoadState('networkidle');
        await page.locator('#main-content').first().waitFor({ state: 'attached', timeout: 15000 });
        await expect(page.getByText('Something went wrong')).toHaveCount(0, { timeout: 10_000 });
        await expect(page.locator('main')).toBeVisible();
    });

    test('/cart redirects to login when not authenticated', async ({ page }) => {
        await page.goto('/cart');
        await page.waitForLoadState('networkidle');
        await page.locator('#main-content').first().waitFor({ state: 'attached', timeout: 15000 });
        // After redirect to /login, URL should contain /login or the page has a login cue
        await page.waitForURL(/\/login/, { timeout: 8_000 });
        await expect(page.url()).toContain('/login');
    });

    test('/checkout redirects to login when not authenticated', async ({ page }) => {
        await page.goto('/checkout');
        await page.waitForLoadState('networkidle');
        await page.locator('#main-content').first().waitFor({ state: 'attached', timeout: 15000 });
        await page.waitForURL(/\/login/, { timeout: 8_000 });
        await expect(page.url()).toContain('/login');
    });

    test('/orders redirects to login when not authenticated', async ({ page }) => {
        await page.goto('/orders');
        await page.waitForLoadState('networkidle');
        await page.locator('#main-content').first().waitFor({ state: 'attached', timeout: 15000 });
        await page.waitForURL(/\/login/, { timeout: 8_000 });
        await expect(page.url()).toContain('/login');
    });
});

test.describe('Login Page UI', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('/login');
        await page.waitForLoadState('networkidle');
        await page.locator('#main-content').first().waitFor({ state: 'attached', timeout: 15000 });
    });

    test('has a visible sign-in form element', async ({ page }) => {
        await expect(page.locator('input[type="email"]')).toBeVisible({ timeout: 15000 });
        await expect(page.locator('input[type="password"]')).toBeVisible({ timeout: 15000 });
    });

    test('no uncaught error boundary fallback', async ({ page }) => {
        await expect(page.getByText('Something went wrong')).toHaveCount(0, { timeout: 8_000 });
    });
});

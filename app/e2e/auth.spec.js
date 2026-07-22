import AxeBuilder from '@axe-core/playwright';
import { test, expect } from '@playwright/test';

const BLOCKING_A11Y_IMPACTS = new Set(['serious', 'critical']);

/**
 * e2e/auth.spec.js — Authentication routing smoke tests.
 *
 * Verifies that protected routes redirect unauthenticated users to login,
 * and that the login page renders without crash.
 */
async function waitForAuthShell(page, path) {
    await page.goto(path);
    await page.locator('#main-content').first().waitFor({ state: 'attached', timeout: 15000 });
}

test.describe('Authentication Guards', () => {
    test('login page renders without crash', async ({ page }) => {
        await waitForAuthShell(page, '/login');
        await expect(page.getByText('Something went wrong')).toHaveCount(0, { timeout: 10_000 });
        await expect(page.locator('main')).toBeVisible();
    });

    test('/cart remains accessible when not authenticated', async ({ page }) => {
        await waitForAuthShell(page, '/cart');
        await expect(page).toHaveURL(/\/cart$/);
        await expect(page.locator('main')).toBeVisible();
        await expect(page.getByRole('heading', { name: /your bag|your bag is empty|your cart is empty/i })).toBeVisible();
    });

    test('/wishlist remains accessible when not authenticated', async ({ page }) => {
        await waitForAuthShell(page, '/wishlist');
        await expect(page).toHaveURL(/\/wishlist$/);
        await expect(page.locator('main')).toBeVisible();
        await expect(page.getByRole('heading', { name: /saved items|your wishlist is empty/i })).toBeVisible();
    });

    test('/checkout redirects to login when not authenticated', async ({ page }) => {
        await waitForAuthShell(page, '/checkout');
        await page.waitForURL(/\/login/, { timeout: 8_000 });
        await expect(page.url()).toContain('/login');
    });

    test('/orders redirects to login when not authenticated', async ({ page }) => {
        await waitForAuthShell(page, '/orders');
        await page.waitForURL(/\/login/, { timeout: 8_000 });
        await expect(page.url()).toContain('/login');
    });
});

test.describe('Login Page UI', () => {
    test.beforeEach(async ({ page }) => {
        await waitForAuthShell(page, '/login');
    });

    test('has a visible sign-in form element', async ({ page }) => {
        await expect(page.locator('input[type="email"]')).toBeVisible({ timeout: 15000 });
        await expect(page.locator('input[type="password"]')).toBeVisible({ timeout: 15000 });
    });

    test('no uncaught error boundary fallback', async ({ page }) => {
        await expect(page.getByText('Something went wrong')).toHaveCount(0, { timeout: 8_000 });
    });

    test('country code dialog is searchable and keyboard complete', async ({ page }) => {
        const trigger = page.getByRole('button', { name: /change country code/i });
        await expect(trigger).toBeVisible();
        await trigger.click();

        const dialog = page.getByRole('dialog', { name: /choose country code/i });
        const search = dialog.getByRole('searchbox', { name: /search countries or dial codes/i });
        await expect(dialog).toBeVisible();
        await expect(search).toBeFocused();

        await search.fill('India');
        const indiaOption = dialog.getByRole('option', { name: /India.*\+91/i });
        await expect(indiaOption).toBeVisible();
        await search.press('ArrowDown');
        await expect(dialog.getByRole('option').first()).toBeFocused();
        await page.keyboard.press('End');
        await expect(indiaOption).toBeFocused();
        await page.keyboard.press('Enter');

        await expect(dialog).toBeHidden();
        await expect(trigger).toHaveAccessibleName(/India.*\+91/i);
        await expect(trigger).toBeFocused();

        await trigger.click();
        await page.keyboard.press('Escape');
        await expect(dialog).toBeHidden();
        await expect(trigger).toBeFocused();
    });

    test('offline state preserves the form and disables network actions', async ({ context, page }) => {
        await context.setOffline(true);
        await page.evaluate(() => window.dispatchEvent(new Event('offline')));

        await expect(page.getByText(/you are offline\. your details stay here/i)).toBeVisible();
        await expect(page.getByRole('button', { name: /reconnect to continue/i })).toBeDisabled();
        await expect(page.locator('input[type="email"]')).toBeEnabled();

        await context.setOffline(false);
        await page.evaluate(() => window.dispatchEvent(new Event('online')));
        await expect(page.getByText(/you are offline\. your details stay here/i)).toBeHidden();
    });

    test('sign-up and recovery modes keep their required fields discoverable', async ({ page }) => {
        await page.getByRole('button', { name: /^sign up$/i }).click();
        await expect(page.getByLabel(/full name/i)).toBeVisible();
        await expect(page.getByLabel(/confirm password/i)).toBeVisible();

        await page.getByRole('button', { name: /^sign in$/i }).click();
        await page.getByRole('button', { name: /forgot password/i }).click();
        await expect(page.getByLabel(/registered email/i)).toBeVisible();
        await expect(page.getByRole('button', { name: /^sign in$/i })).toBeVisible();
    });

    test('has no serious accessibility violations or horizontal overflow', async ({ page }) => {
        const results = await new AxeBuilder({ page }).include('.login-experience').analyze();
        const blockingViolations = results.violations.filter(({ impact }) => BLOCKING_A11Y_IMPACTS.has(impact));
        const horizontalOverflow = await page.evaluate(() => Math.max(
            document.documentElement.scrollWidth - document.documentElement.clientWidth,
            document.body.scrollWidth - document.documentElement.clientWidth,
            0
        ));

        expect(blockingViolations).toEqual([]);
        expect(horizontalOverflow).toBeLessThanOrEqual(2);
    });
});

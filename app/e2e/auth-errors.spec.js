import { test, expect } from '@playwright/test';

/**
 * e2e/auth-errors.spec.js — Positive auth error-message coverage.
 *
 * Proves wrong-credentials failures surface as specific, actionable banners
 * end-to-end (never the generic fallback) through the real login UI:
 *
 * 1. Firebase rejects the credentials (identitytoolkit intercepted) ->
 *    "Invalid Credentials" banner in an assertive live region.
 * 2. Same seam with a legacy wrong-password error ->
 *    "Wrong Password" banner with recovery guidance.
 *
 * Firebase phone (recaptcha) delivery is force-disabled via route abort so
 * the flow deterministically reaches the credential check instead of
 * stalling on an unsolvable visual challenge.
 *
 * Note: the backend-401 "Session Expired" banner is covered one layer down —
 * B1 contract test (backend string -> catalog mapping) + controller Vitest
 * (sessionError seeding) — because the OTP UI always attempts the
 * Firebase-phone challenge first in a real browser, making a backend-401
 * unreachable without solving reCAPTCHA.
 */

const FIREBASE_INVALID_CREDENTIALS = {
    status: 400,
    contentType: 'application/json',
    body: JSON.stringify({
        error: {
            code: 400,
            message: 'INVALID_LOGIN_CREDENTIALS',
            errors: [{ message: 'INVALID_LOGIN_CREDENTIALS', domain: 'global', reason: 'invalid' }],
        },
    }),
};

async function gotoLogin(page) {
    await page.goto('/login');
    await page.locator('#main-content').first().waitFor({ state: 'attached', timeout: 15000 });
    await expect(page.locator('input[type="email"]')).toBeVisible({ timeout: 15000 });
}

async function disableFirebasePhoneDelivery(page) {
    // Force the Firebase-phone challenge to fail fast with a recaptcha-
    // flavored error so resolveFirebasePhoneFallback routes to backend OTP.
    await page.route('**/recaptcha/**', (route) => route.abort('failed'));
    await page.route('**/gstatic.com/recaptcha/**', (route) => route.abort('failed'));
}

// The credential-check flow requires a Firebase-configured build. Environments
// without the public VITE_FIREBASE_* variables render the "Authentication Not
// Configured" fallback instead of the sign-in form — skip rather than fail.
async function skipUnlessFirebaseAuthConfigured(page, test) {
    const unconfiguredNotice = page.getByText(
        'Firebase authentication is not configured correctly',
    );
    if (await unconfiguredNotice.count()) {
        test.skip(true, 'Firebase web config is unavailable in this environment');
    }
}

test.describe('Auth error messages', () => {
    test('wrong password shows the Invalid Credentials banner, not a generic error', async ({ page }) => {
        await disableFirebasePhoneDelivery(page);
        await page.route('**/identitytoolkit.googleapis.com/**', (route) => {
            if (route.request().url().includes('signInWithPassword')) {
                return route.fulfill(FIREBASE_INVALID_CREDENTIALS);
            }
            return route.continue();
        });

        await gotoLogin(page);
        await skipUnlessFirebaseAuthConfigured(page, test);
        await page.locator('input[type="email"]').fill('e2e-user@example.com');
        await page.locator('input[type="password"]').fill('WrongPassword!123');
        await page.getByLabel('Phone number').fill('9876543210');
        await page.locator('form button[type="submit"]').click();

        const banner = page.locator('.login-feedback--error');
        await expect(banner).toBeVisible({ timeout: 15000 });
        await expect(banner.getByText('Invalid Credentials')).toBeVisible();
        await expect(banner).toHaveAttribute('aria-live', 'assertive');
        await expect(page.getByText('Something went wrong')).toHaveCount(0);
    });

    test('wrong password shows the Wrong Password banner with recovery guidance', async ({ page }) => {
        await disableFirebasePhoneDelivery(page);
        await page.route('**/identitytoolkit.googleapis.com/**', (route) => {
            if (route.request().url().includes('signInWithPassword')) {
                return route.fulfill({
                    status: 400,
                    contentType: 'application/json',
                    body: JSON.stringify({
                        error: {
                            code: 400,
                            message: 'INVALID_PASSWORD',
                            errors: [{ message: 'INVALID_PASSWORD', domain: 'global', reason: 'invalid' }],
                        },
                    }),
                });
            }
            return route.continue();
        });

        await gotoLogin(page);
        await skipUnlessFirebaseAuthConfigured(page, test);
        await page.locator('input[type="email"]').fill('e2e-user@example.com');
        await page.locator('input[type="password"]').fill('WrongPassword!123');
        await page.getByLabel('Phone number').fill('9876543210');
        await page.locator('form button[type="submit"]').click();

        const banner = page.locator('.login-feedback--error');
        await expect(banner).toBeVisible({ timeout: 15000 });
        await expect(banner.getByText('Wrong Password')).toBeVisible();
        await expect(banner).toHaveAttribute('aria-live', 'assertive');
        await expect(page.getByText('Something went wrong')).toHaveCount(0);
    });
});

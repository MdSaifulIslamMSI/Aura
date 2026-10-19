import { test, expect } from '@playwright/test';
import {
    TELEMETRY_CONSENT_STORAGE_KEY,
    TELEMETRY_CONSENT_DENIED,
    TELEMETRY_CONSENT_GRANTED,
} from './support/telemetryConsent';
import {
    mockProductDetailApis,
    seedGuestCommerceState,
    waitForAppShell,
} from './support/commerceState.js';

/**
 * e2e/telemetry-consent.spec.js — proves the consent gate in a real browser.
 *
 * The property under test is the security property, not the styling: before
 * the visitor opts in, no third-party session-capture surface is live and
 * nothing is sent anywhere. "Undecided" must behave exactly like "denied",
 * because that is the state every first visit is in.
 */
test.describe('Telemetry consent gate', () => {
    test.beforeEach(async ({ page }) => {
        await page.addInitScript(() => {
            window.localStorage.clear();
            window.sessionStorage.clear();
        });
    });

    test('prompts on a first visit and captures nothing until the visitor allows it', async ({ page }) => {
        const thirdPartyRequests = [];
        page.on('request', (request) => {
            const url = request.url();
            if (url.includes('sentry') || url.includes('datadoghq')) {
                thirdPartyRequests.push(url);
            }
        });

        await page.goto('/');
        await expect(page.getByRole('dialog', { name: 'Privacy' })).toBeVisible();

        // The prompt is on screen, so nothing has been captured yet.
        expect(thirdPartyRequests).toEqual([]);

        const stored = await page.evaluate(
            (key) => window.localStorage.getItem(key),
            TELEMETRY_CONSENT_STORAGE_KEY,
        );
        expect(stored).toBeNull();
    });

    test('declining records a denied decision and dismisses the prompt', async ({ page }) => {
        await page.goto('/');

        await page.getByRole('button', { name: 'No thanks' }).click();
        await expect(page.getByRole('dialog', { name: 'Privacy' })).toHaveCount(0);

        const stored = await page.evaluate(
            (key) => window.localStorage.getItem(key),
            TELEMETRY_CONSENT_STORAGE_KEY,
        );
        expect(stored).toBe(TELEMETRY_CONSENT_DENIED);
    });

    test('dismissing the prompt without deciding records a denied decision', async ({ page }) => {
        await page.goto('/');

        await page.getByRole('button', { name: 'Dismiss' }).click();
        await expect(page.getByRole('dialog', { name: 'Privacy' })).toHaveCount(0);

        const stored = await page.evaluate(
            (key) => window.localStorage.getItem(key),
            TELEMETRY_CONSENT_STORAGE_KEY,
        );
        expect(stored).toBe(TELEMETRY_CONSENT_DENIED);
    });

    test('allowing records a granted decision and shows the enabled state', async ({ page }) => {
        await page.goto('/');

        await page.getByRole('button', { name: 'Allow' }).click();

        const stored = await page.evaluate(
            (key) => window.localStorage.getItem(key),
            TELEMETRY_CONSENT_STORAGE_KEY,
        );
        expect(stored).toBe(TELEMETRY_CONSENT_GRANTED);
        await expect(page.getByRole('button', { name: 'Turn off' })).toBeVisible();
    });

    test('a stored decision means the prompt never appears again', async ({ page }) => {
        await page.addInitScript(
            ({ key, value }) => {
                window.localStorage.setItem(key, value);
            },
            { key: TELEMETRY_CONSENT_STORAGE_KEY, value: TELEMETRY_CONSENT_DENIED },
        );

        await page.goto('/');
        await expect(page.getByRole('dialog', { name: 'Privacy' })).toHaveCount(0);
    });

    // The prompt is a fixed bottom overlay mounted globally, so it physically
    // overlaps page controls. On a mobile product page that is the sticky buy
    // bar, and an undecided prompt that swallows its taps breaks the primary
    // purchase action. It must never intercept a pointer event meant for a
    // control underneath.
    test.describe('on a mobile viewport', () => {
        test.use({ viewport: { width: 412, height: 915 } });

        test('an undecided prompt never blocks the sticky buy bar underneath', async ({ page }) => {
            const product = await mockProductDetailApis(page, {
                productId: 995001,
                product: {
                    title: 'Aura Flux Phone Max',
                    displayTitle: 'Aura Flux Phone Max',
                },
            });

            await seedGuestCommerceState(page);
            await waitForAppShell(page, `/product/${product.id}`);

            // The prompt is on screen and undecided - this is every first visit.
            await expect(page.getByRole('dialog', { name: 'Privacy' })).toBeVisible();

            const mobileBuybar = page.locator('div.fixed.bottom-0.left-0.right-0.z-50').first();
            const addToBag = mobileBuybar.getByRole('button').first();
            await expect(addToBag).toBeVisible();

            // A short timeout makes an interception fail fast instead of
            // burning the whole budget on Playwright's actionability retry.
            await addToBag.click({ timeout: 10_000 });

            await expect(
                page.getByRole('button', {
                    name: new RegExp(`increase quantity for ${product.title}`, 'i'),
                }).first(),
            ).toBeVisible();
        });
    });
});

import { test as base, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const getAuthState = () => {
    const encoded = String(process.env.ACCOUNT_CENTER_STAGING_AUTH_STATE || '').trim();
    if (!encoded) {
        throw new Error('Account Center staging auth state was not prepared by global setup.');
    }
    const state = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
    if (
        !Array.isArray(state?.storageState?.cookies)
        || !Array.isArray(state?.storageState?.origins)
        || !state.storageState.origins.some(
            (origin) => origin.indexedDB?.some(
                (database) => database.name === 'firebaseLocalStorageDb'
            )
        )
    ) {
        throw new Error('Account Center staging auth state is incomplete.');
    }
    return state;
};

const test = base.extend({
    storageState: async ({}, use) => {
        await use(getAuthState().storageState);
    },
});

const assertNoSeriousAxeViolations = async (page) => {
    const result = await new AxeBuilder({ page })
        .include('.account-center-experience')
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
        .analyze();
    const blocking = result.violations.filter(
        (violation) => violation.impact === 'critical' || violation.impact === 'serious'
    );
    expect(blocking, JSON.stringify(blocking, null, 2)).toEqual([]);
};

test('renders responsive authenticated Account Center with WCAG-critical automation', async ({ page }, testInfo) => {
    await page.goto('/profile');
    await expect(page).toHaveURL(/\/profile(?:\?|$)/);
    await expect(page.locator('.account-center-experience')).toBeVisible();
    await expect(page.locator('#account-center-page-title')).toBeVisible();

    await assertNoSeriousAxeViolations(page);
    await page.keyboard.press('Tab');
    const focused = page.locator(':focus');
    await expect(focused).toBeVisible();

    await page.screenshot({
        path: testInfo.outputPath(`account-center-${testInfo.project.name}.png`),
        fullPage: true,
    });
});

test('surfaces offline state and recovers without losing the authenticated shell', async ({ page, context }) => {
    await page.goto('/profile?tab=settings');
    await expect(page.locator('.account-center-experience')).toBeVisible();

    await context.setOffline(true);
    await page.evaluate(() => window.dispatchEvent(new Event('offline')));
    await expect(page.getByText('You are offline.', { exact: false })).toBeVisible();

    await context.setOffline(false);
    await page.evaluate(() => window.dispatchEvent(new Event('online')));
    await page.reload();
    await expect(page.locator('.account-center-experience')).toBeVisible();
    await expect(page.locator('#account-center-page-title')).toBeVisible();
});

test('keeps a stable loading shell on a slow authenticated profile response', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop-1440', 'One desktop trace covers the constrained network state.');
    await page.route('**/api/users/profile*', async (route) => {
        await new Promise((resolve) => setTimeout(resolve, 1_200));
        await route.continue();
    });

    await page.goto('/profile');
    const accountCenter = page.locator('.account-center-experience');
    await expect(accountCenter.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(accountCenter).toBeVisible();
    await expect(page.locator('#account-center-page-title')).toBeVisible();
});

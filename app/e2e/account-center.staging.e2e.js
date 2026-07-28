import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const getAuthState = () => {
    const encoded = String(process.env.ACCOUNT_CENTER_STAGING_AUTH_STATE || '').trim();
    if (!encoded) {
        throw new Error('Account Center staging auth state was not prepared by global setup.');
    }
    const state = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
    if (
        !state?.firebaseSession?.apiKey
        || !state.firebaseSession.idToken
        || !state.firebaseSession.email
        || !Array.isArray(state?.cookies)
    ) {
        throw new Error('Account Center staging auth state is incomplete.');
    }
    return state;
};

const installFirebaseSession = async (page, firebaseSession) => {
    await page.goto('/login');
    await page.evaluate(({ key, accountEmail, session }) => new Promise((resolve, reject) => {
        const openRequest = indexedDB.open('firebaseLocalStorageDb', 1);
        openRequest.onupgradeneeded = () => {
            const database = openRequest.result;
            if (!database.objectStoreNames.contains('firebaseLocalStorage')) {
                database.createObjectStore('firebaseLocalStorage', { keyPath: 'fbase_key' });
            }
        };
        openRequest.onerror = () => reject(openRequest.error);
        openRequest.onsuccess = () => {
            const database = openRequest.result;
            const transaction = database.transaction('firebaseLocalStorage', 'readwrite');
            transaction.onerror = () => reject(transaction.error);
            transaction.oncomplete = () => resolve();
            transaction.objectStore('firebaseLocalStorage').put({
                fbase_key: `firebase:authUser:${key}:[DEFAULT]`,
                value: {
                    uid: session.localId,
                    email: session.email || accountEmail,
                    emailVerified: true,
                    isAnonymous: false,
                    providerData: [{
                        providerId: 'password',
                        uid: session.email || accountEmail,
                        displayName: null,
                        email: session.email || accountEmail,
                        phoneNumber: null,
                        photoURL: null,
                    }],
                    stsTokenManager: {
                        refreshToken: session.refreshToken,
                        accessToken: session.idToken,
                        expirationTime: Date.now() + (Number(session.expiresIn || 3600) * 1000),
                    },
                    createdAt: String(Date.now()),
                    lastLoginAt: String(Date.now()),
                    apiKey: key,
                    appName: '[DEFAULT]',
                },
            });
        };
    }), {
        key: firebaseSession.apiKey,
        accountEmail: firebaseSession.email,
        session: firebaseSession,
    });
};

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

test.beforeEach(async ({ page }) => {
    const authState = getAuthState();
    await page.context().addCookies(authState.cookies);
    await installFirebaseSession(page, authState.firebaseSession);
});

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

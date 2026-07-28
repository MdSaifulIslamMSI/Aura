import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const apiKey = String(process.env.SMOKE_FIREBASE_API_KEY || '').trim();
const email = String(process.env.SMOKE_USER_EMAIL || '').trim();
const password = String(process.env.SMOKE_USER_PASSWORD || '').trim();

const signInWithFirebase = async (request) => {
    const response = await request.post(
        `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${encodeURIComponent(apiKey)}`,
        {
            data: { email, password, returnSecureToken: true },
        }
    );
    expect(response.ok()).toBeTruthy();
    const payload = await response.json();
    expect(payload.idToken).toBeTruthy();
    expect(payload.refreshToken).toBeTruthy();
    return payload;
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
        key: apiKey,
        accountEmail: email,
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

test.beforeEach(async ({ page, request }) => {
    expect(apiKey).toBeTruthy();
    expect(email).toBeTruthy();
    expect(password).toBeTruthy();
    const session = await signInWithFirebase(request);
    const syncResponse = await request.post('/api/auth/sync', {
        headers: {
            Authorization: `Bearer ${session.idToken}`,
            'Idempotency-Key': `account-browser-${Date.now()}`,
        },
        data: {
            email,
            name: 'Account Qualification Customer',
            phone: '+919999999999',
        },
    });
    expect(syncResponse.ok()).toBeTruthy();
    await installFirebaseSession(page, session);
});

test('renders responsive authenticated Account Center with WCAG-critical automation', async ({ page }, testInfo) => {
    await page.goto('/profile');
    await expect(page).toHaveURL(/\/profile(?:\?|$)/);
    await expect(page.locator('.account-center-experience')).toBeVisible();
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

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
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
});

test('keeps a stable loading shell on a slow authenticated profile response', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop-1440', 'One desktop trace covers the constrained network state.');
    await page.route('**/api/users/profile*', async (route) => {
        await new Promise((resolve) => setTimeout(resolve, 1_200));
        await route.continue();
    });

    await page.goto('/profile');
    await expect(page.getByRole('heading', { name: 'Preparing your account' })).toBeVisible();
    await expect(page.locator('.account-center-experience')).toBeVisible();
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
});

import { chromium, request } from '@playwright/test';

const requiredEnv = (name) => {
    const value = String(process.env[name] || '').trim();
    if (!value) {
        throw new Error(`Authenticated Account Center Playwright requires ${name}.`);
    }
    return value;
};

const describeSyncFailure = async (response) => {
    const payload = await response.json().catch(() => ({}));
    const code = String(payload?.code || 'UNKNOWN').trim();
    const retryAfter = Number(payload?.retryAfter || 0);
    return `Account sync failed with HTTP ${response.status()} (${code})${retryAfter > 0 ? `; retry after ${retryAfter}s` : ''}.`;
};

const buildFirebaseAuthUser = ({ apiKey, email, firebaseSession }) => {
    const now = Date.now();
    return {
        uid: firebaseSession.localId,
        email: firebaseSession.email || email,
        emailVerified: true,
        isAnonymous: false,
        providerData: [{
            providerId: 'password',
            uid: firebaseSession.email || email,
            displayName: null,
            email: firebaseSession.email || email,
            phoneNumber: null,
            photoURL: null,
        }],
        stsTokenManager: {
            refreshToken: firebaseSession.refreshToken,
            accessToken: firebaseSession.idToken,
            expirationTime: now + (Number(firebaseSession.expiresIn || 3600) * 1000),
        },
        createdAt: String(now),
        lastLoginAt: String(now),
        apiKey,
        appName: '[DEFAULT]',
    };
};

const buildBrowserStorageState = async ({
    apiKey,
    baseURL,
    cookies,
    email,
    firebaseSession,
}) => {
    const browser = await chromium.launch();
    const context = await browser.newContext();

    try {
        await context.addCookies(cookies);
        const page = await context.newPage();
        await page.goto(`${baseURL}/login`, { waitUntil: 'domcontentloaded' });
        await page.evaluate(({ key, authUser }) => new Promise((resolve, reject) => {
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
                const finish = (callback, value) => {
                    database.close();
                    callback(value);
                };
                transaction.onerror = () => finish(reject, transaction.error);
                transaction.onabort = () => finish(reject, transaction.error);
                transaction.oncomplete = () => finish(resolve);
                transaction.objectStore('firebaseLocalStorage').put({
                    fbase_key: `firebase:authUser:${key}:[DEFAULT]`,
                    value: authUser,
                });
            };
        }), {
            key: apiKey,
            authUser: buildFirebaseAuthUser({ apiKey, email, firebaseSession }),
        });

        const storageState = await context.storageState({ indexedDB: true });
        const stagingOrigin = new URL(baseURL).origin;
        const originState = storageState.origins.find((entry) => entry.origin === stagingOrigin);
        if (!originState?.indexedDB?.some((database) => database.name === 'firebaseLocalStorageDb')) {
            throw new Error('Firebase staging authentication was not captured in browser storage state.');
        }
        return storageState;
    } finally {
        await context.close();
        await browser.close();
    }
};

export default async function accountCenterStagingSetup() {
    const baseURL = requiredEnv('STAGING_BASE_URL').replace(/\/+$/, '');
    const apiKey = requiredEnv('SMOKE_FIREBASE_API_KEY');
    const email = requiredEnv('SMOKE_USER_EMAIL');
    const password = requiredEnv('SMOKE_USER_PASSWORD');
    const name = String(process.env.SMOKE_USER_NAME || 'Account Qualification Customer').trim();
    const phone = String(process.env.SMOKE_USER_PHONE || '+919999999999').trim();
    const api = await request.newContext({ baseURL });

    try {
        const signInResponse = await api.post(
            `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${encodeURIComponent(apiKey)}`,
            {
                data: { email, password, returnSecureToken: true },
            }
        );
        if (!signInResponse.ok()) {
            throw new Error(`Firebase staging sign-in failed with HTTP ${signInResponse.status()}.`);
        }

        const firebaseSession = await signInResponse.json();
        if (!firebaseSession.idToken || !firebaseSession.refreshToken || !firebaseSession.localId) {
            throw new Error('Firebase staging sign-in returned an incomplete session.');
        }

        const syncResponse = await api.post('/api/auth/sync', {
            headers: {
                Authorization: `Bearer ${firebaseSession.idToken}`,
                'Idempotency-Key': `account-browser-${Date.now()}`,
            },
            data: { email, name, phone },
        });
        if (!syncResponse.ok()) {
            throw new Error(await describeSyncFailure(syncResponse));
        }

        const apiStorageState = await api.storageState();
        const storageState = await buildBrowserStorageState({
            apiKey,
            baseURL,
            cookies: apiStorageState.cookies,
            email,
            firebaseSession,
        });
        process.env.ACCOUNT_CENTER_STAGING_AUTH_STATE = Buffer.from(JSON.stringify({
            storageState,
        })).toString('base64url');
    } finally {
        await api.dispose();
    }
}

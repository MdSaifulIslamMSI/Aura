import { request } from '@playwright/test';

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

        const storageState = await api.storageState();
        process.env.ACCOUNT_CENTER_STAGING_AUTH_STATE = Buffer.from(JSON.stringify({
            cookies: storageState.cookies,
            firebaseSession: {
                email: firebaseSession.email || email,
                expiresIn: firebaseSession.expiresIn,
                idToken: firebaseSession.idToken,
                localId: firebaseSession.localId,
                refreshToken: firebaseSession.refreshToken,
            },
        })).toString('base64url');
    } finally {
        await api.dispose();
    }
}

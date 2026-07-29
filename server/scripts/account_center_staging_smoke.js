/* eslint-disable no-console */
const crypto = require('crypto');
const sharp = require('sharp');
const { signInWithEmailPassword } = require('./lib/firebaseEmailAuth');

const normalizeUrl = (value) => String(value || '').trim().replace(/\/+$/, '');
const baseUrl = normalizeUrl(process.env.SMOKE_BASE_URL);
const RATE_LIMIT_DEPENDENCY_MESSAGE = 'Rate limiter dependency unavailable. Please try again shortly.';
const RATE_LIMIT_RECOVERY_DELAY_MS = 11_000;
const FIREBASE_NETWORK_RECOVERY_DELAY_MS = 5_000;
const AVATAR_SCAN_UNAVAILABLE_MESSAGE = 'Avatar malware scan unavailable. Please try again later.';
const SAFE_FAILURE_CODES = new Set([
    'ATTACK_MODE_ROUTE_DISABLED',
    'AUTH_BUDGET_EXCEEDED',
    'TRAFFIC_LOAD_SHEDDING',
    'TRAFFIC_ROUTE_TIMEOUT',
]);
const allowedSessionFields = new Set([
    'id',
    'current',
    'client',
    'os',
    'createdAt',
    'lastActiveAt',
    'expiresAt',
]);

const assert = (condition, message) => {
    if (!condition) throw new Error(message);
};

const assertStagingTarget = (env = process.env) => {
    const target = normalizeUrl(env.SMOKE_BASE_URL);
    assert(env.SMOKE_TARGET_ENV === 'staging', 'SMOKE_TARGET_ENV must be staging');
    assert(env.SMOKE_STAGING_ISOLATED === 'true', 'SMOKE_STAGING_ISOLATED must be true');
    assert(env.STAGING_SSM_PREFIX === '/aura/staging', 'STAGING_SSM_PREFIX must be /aura/staging');
    assert(/^https:\/\//i.test(target), 'SMOKE_BASE_URL must use HTTPS');
    for (const productionUrl of [env.PROD_BASE_URL, env.PROD_API_BASE_URL].map(normalizeUrl).filter(Boolean)) {
        assert(target !== productionUrl, 'Account qualification refuses a production target');
    }
    return target;
};

const assertSafeSessionProjection = (sessions = []) => {
    for (const session of Array.isArray(sessions) ? sessions : []) {
        const unexpected = Object.keys(session || {}).filter((field) => !allowedSessionFields.has(field));
        assert(unexpected.length === 0, `Session response exposed unexpected fields: ${unexpected.join(', ')}`);
        assert(/^[A-Za-z0-9_-]{43}$/.test(String(session.id || '')), 'Session alias must be opaque');
    }
};

const assertAvatarScanDisabledFailClosed = ({ payload = {}, status }) => {
    assert(status === 503, `Disabled avatar scanner must fail closed with 503; got ${status}`);
    assert(
        String(payload?.message || '') === AVATAR_SCAN_UNAVAILABLE_MESSAGE,
        'Disabled avatar scanner returned an unexpected failure'
    );
    assert(!payload?.finalizeToken, 'Fail-closed avatar upload exposed a finalize token');
    assert(!payload?.avatar, 'Fail-closed avatar upload exposed an avatar');
};

const isRetryableFirebaseNetworkError = (error) => (
    error instanceof TypeError
    && String(error?.message || '').trim().toLowerCase() === 'fetch failed'
);

const printStep = (name, detail = '') => {
    console.log(`[ok] ${name}${detail ? ` - ${detail}` : ''}`);
};

const classifyFailurePayload = (payload = {}) => {
    const rawCode = String(payload?.code || '').trim().toUpperCase();
    const code = SAFE_FAILURE_CODES.has(rawCode) ? rawCode : (rawCode ? 'OTHER' : 'NONE');
    const message = String(payload?.message || '').trim();
    const retryAfterValue = Number(payload?.retryAfter || 0);
    const retryAfter = Number.isInteger(retryAfterValue) && retryAfterValue > 0 && retryAfterValue <= 86_400
        ? retryAfterValue
        : 0;
    let reason = 'unknown';

    if (message === RATE_LIMIT_DEPENDENCY_MESSAGE) {
        reason = 'rate_limit_dependency_unavailable';
    } else if (code === 'ATTACK_MODE_ROUTE_DISABLED') {
        reason = 'attack_mode_route_disabled';
    } else if (code === 'TRAFFIC_LOAD_SHEDDING') {
        reason = 'traffic_load_shedding';
    } else if (code === 'TRAFFIC_ROUTE_TIMEOUT') {
        reason = 'traffic_route_timeout';
    }

    return { code, reason, retryAfter };
};

const shouldRetryRateLimitDependency = ({
    attempt,
    payload,
    retryRateLimitDependency,
    status,
}) => (
    retryRateLimitDependency === true
    && attempt === 0
    && status === 503
    && classifyFailurePayload(payload).reason === 'rate_limit_dependency_unavailable'
);

const shouldRetryIdempotentTransientFailure = ({
    attempt,
    payload,
    retryIdempotentTransientFailure,
    status,
}) => (
    retryIdempotentTransientFailure === true
    && attempt === 0
    && status === 503
    && ['rate_limit_dependency_unavailable', 'traffic_route_timeout']
        .includes(classifyFailurePayload(payload).reason)
);

const requestJson = async (pathname, {
    method = 'GET',
    token = '',
    body,
    expectedStatuses = [200],
    headers = {},
    retryRateLimitDependency = false,
    retryIdempotentTransientFailure = false,
} = {}) => {
    for (let attempt = 0; attempt < 2; attempt += 1) {
        const response = await fetch(new URL(pathname, `${baseUrl}/`), {
            method,
            headers: {
                ...(token ? { Authorization: `Bearer ${token}` } : {}),
                ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
                ...headers,
            },
            ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
        });
        const payload = await response.json().catch(() => ({}));
        if (expectedStatuses.includes(response.status)) {
            return { payload, response };
        }
        const retryRateLimit = shouldRetryRateLimitDependency({
            attempt,
            payload,
            retryRateLimitDependency,
            status: response.status,
        });
        const retryIdempotentTransient = shouldRetryIdempotentTransientFailure({
            attempt,
            payload,
            retryIdempotentTransientFailure,
            status: response.status,
        });
        if (retryRateLimit || retryIdempotentTransient) {
            const failure = classifyFailurePayload(payload);
            console.warn(`[retry] ${method} ${pathname} after ${failure.reason}`);
            await new Promise((resolve) => setTimeout(resolve, RATE_LIMIT_RECOVERY_DELAY_MS));
            continue;
        }
        const failure = classifyFailurePayload(payload);
        throw new Error(
            `${method} ${pathname} returned unexpected status ${response.status}`
            + ` code=${failure.code} reason=${failure.reason} retryAfter=${failure.retryAfter}`
        );
    }

    throw new Error(`${method} ${pathname} exhausted the bounded dependency recovery attempt`);
};

const signIn = async ({ email, password }) => {
    for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
            const result = await signInWithEmailPassword({
                apiKey: process.env.SMOKE_FIREBASE_API_KEY,
                email,
                password,
            });
            assert(result.idToken, 'Firebase sign-in did not return an ID token');
            return result.idToken;
        } catch (error) {
            if (attempt === 0 && isRetryableFirebaseNetworkError(error)) {
                console.warn('[retry] Firebase sign-in after transport failure');
                await new Promise((resolve) => setTimeout(resolve, FIREBASE_NETWORK_RECOVERY_DELAY_MS));
                continue;
            }
            throw error;
        }
    }

    throw new Error('Firebase sign-in exhausted the bounded transport recovery attempt');
};

const syncAccount = async ({ token, email, name, phone }) => {
    const { payload } = await requestJson('/api/auth/sync', {
        method: 'POST',
        token,
        expectedStatuses: [200],
        headers: { 'Idempotency-Key': `account-qualification-${crypto.randomUUID()}` },
        body: { email, name, phone },
        retryIdempotentTransientFailure: true,
    });
    assert(payload.status === 'authenticated', 'Account sync did not authenticate');
};

const buildAvatarDataUrl = async () => {
    const buffer = await sharp({
        create: {
            width: 8,
            height: 8,
            channels: 4,
            background: { r: 35, g: 78, b: 62, alpha: 1 },
        },
    }).png().toBuffer();
    return {
        dataUrl: `data:image/png;base64,${buffer.toString('base64')}`,
        sizeBytes: buffer.length,
    };
};

const run = async () => {
    assertStagingTarget();
    const primary = {
        email: String(process.env.SMOKE_USER_EMAIL || '').trim(),
        password: String(process.env.SMOKE_USER_PASSWORD || '').trim(),
        name: String(process.env.SMOKE_USER_NAME || 'Account Qualification Customer').trim(),
        phone: String(process.env.SMOKE_USER_PHONE || '+919999999999').trim(),
    };
    const secondary = {
        email: String(process.env.SMOKE_OTHER_USER_EMAIL || '').trim(),
        password: String(process.env.SMOKE_OTHER_USER_PASSWORD || '').trim(),
        name: String(process.env.SMOKE_OTHER_USER_NAME || 'Account Qualification Secondary').trim(),
        phone: String(process.env.SMOKE_OTHER_USER_PHONE || '+919999999997').trim(),
    };
    assert(process.env.SMOKE_FIREBASE_API_KEY, 'SMOKE_FIREBASE_API_KEY is required');
    assert(primary.email && primary.password, 'Primary smoke account credentials are required');
    assert(secondary.email && secondary.password, 'Secondary smoke account credentials are required');

    const [primaryToken, secondaryToken] = await Promise.all([
        signIn(primary),
        signIn(secondary),
    ]);
    await Promise.all([
        syncAccount({ token: primaryToken, ...primary }),
        syncAccount({ token: secondaryToken, ...secondary }),
    ]);
    printStep('auth.owner-boundary', 'two isolated customers');

    const { payload: profile } = await requestJson('/api/users/profile', { token: primaryToken });
    assert(Number.isInteger(Number(profile.version)), 'Profile version is missing');
    const { payload: updatedProfile } = await requestJson('/api/users/profile', {
        method: 'PUT',
        token: primaryToken,
        body: {
            bio: 'Staging Account Center qualification account',
            version: Number(profile.version),
        },
    });
    assert(Number(updatedProfile.version) > Number(profile.version), 'Profile version did not advance');
    printStep('profile.optimistic-write');

    const { payload: preferences } = await requestJson('/api/account/preferences', {
        token: primaryToken,
        retryRateLimitDependency: true,
    });
    assert(Number.isInteger(Number(preferences?.preferences?.version)), 'Preference version is missing');
    const { payload: updatedPreferences } = await requestJson('/api/account/preferences', {
        method: 'PATCH',
        token: primaryToken,
        body: {
            version: Number(preferences.preferences.version),
            localization: {
                language: 'en',
                locale: 'en-IN',
                currency: 'INR',
            },
            accessibility: {
                reducedMotion: true,
            },
        },
    });
    assert(updatedPreferences?.preferences?.localization?.locale === 'en-IN', 'Localization was not persisted');
    printStep('preferences.localization');

    const { payload: telemetry } = await requestJson('/api/observability/client-diagnostics', {
        method: 'POST',
        token: primaryToken,
        expectedStatuses: [202],
        body: {
            events: [{
                type: 'account.section_viewed',
                timestamp: new Date().toISOString(),
                context: { section: 'overview' },
            }],
        },
    });
    assert(telemetry.accepted === 1, 'Typed Account Center telemetry event was not accepted');
    printStep('observability.typed-product-event');

    let addressId = '';
    const addressBody = {
        type: 'other',
        name: 'Account Qualification',
        phone: primary.phone,
        address: `Qualification Road ${String(Date.now()).slice(-6)}`,
        city: 'Bengaluru',
        state: 'Karnataka',
        pincode: '560001',
        isDefault: false,
    };
    try {
        const { payload: createdAddress } = await requestJson('/api/users/addresses', {
            method: 'POST',
            token: primaryToken,
            expectedStatuses: [201],
            body: addressBody,
        });
        const match = (createdAddress.addresses || []).find((entry) => entry.address === addressBody.address);
        addressId = String(match?._id || '').trim();
        assert(/^[a-f0-9]{24}$/i.test(addressId), 'Created address did not return an owner-scoped identifier');

        await requestJson(`/api/users/addresses/${addressId}`, {
            method: 'PUT',
            token: secondaryToken,
            expectedStatuses: [404],
            body: addressBody,
        });
        await requestJson(`/api/users/addresses/${addressId}`, {
            method: 'DELETE',
            token: secondaryToken,
            expectedStatuses: [404],
        });
        printStep('addresses.cross-user-denial');
    } finally {
        if (addressId) {
            await requestJson(`/api/users/addresses/${addressId}`, {
                method: 'DELETE',
                token: primaryToken,
                expectedStatuses: [200, 404],
            });
        }
    }

    const readChecks = await Promise.all([
        requestJson('/api/account/summary', { token: primaryToken }),
        requestJson('/api/users/dashboard', { token: primaryToken }),
        requestJson('/api/users/rewards', { token: primaryToken }),
        requestJson('/api/orders/myorders?limit=5', { token: primaryToken }),
        requestJson('/api/account/marketplace', { token: primaryToken }),
        requestJson('/api/account/security-activity?limit=10', { token: primaryToken }),
        requestJson('/api/account/sessions?limit=10', { token: primaryToken }),
        requestJson('/api/account/privacy/capabilities', { token: primaryToken }),
    ]);
    const securityActivity = readChecks[5].payload;
    for (const event of securityActivity.activity || []) {
        const unexpected = Object.keys(event || {}).filter(
            (field) => !['type', 'outcome', 'occurredAt'].includes(field)
        );
        assert(unexpected.length === 0, `Security activity exposed unexpected fields: ${unexpected.join(', ')}`);
    }
    assertSafeSessionProjection(readChecks[6].payload.data || []);
    assert(readChecks[7].payload.enabled === false, 'Privacy lifecycle must remain fail-closed in staging');
    printStep('account.read-domains', '8 bounded surfaces');

    const avatar = await buildAvatarDataUrl();
    const acceptScannerDisabledFailClosed = process.env.SMOKE_ACCEPT_SCANNER_DISABLED_FAIL_CLOSED === 'true';
    const { payload: intent } = await requestJson('/api/account/avatar/upload-intents', {
        method: 'POST',
        token: primaryToken,
        expectedStatuses: [201],
        body: {
            fileName: 'account-qualification.png',
            mimeType: 'image/png',
            sizeBytes: avatar.sizeBytes,
        },
    });
    const { payload: uploaded, response: uploadResponse } = await requestJson('/api/account/avatar/uploads', {
        method: 'POST',
        token: primaryToken,
        expectedStatuses: acceptScannerDisabledFailClosed ? [201, 503] : [201],
        body: {
            uploadToken: intent.uploadToken,
            fileName: 'account-qualification.png',
            mimeType: 'image/png',
            dataUrl: avatar.dataUrl,
        },
    });
    if (uploadResponse.status === 503) {
        assertAvatarScanDisabledFailClosed({ payload: uploaded, status: uploadResponse.status });
        printStep('avatar.scan-disabled-fail-closed');
    } else {
        const { payload: finalized } = await requestJson('/api/account/avatar/finalize', {
            method: 'POST',
            token: primaryToken,
            body: { finalizeToken: uploaded.finalizeToken },
        });
        assert(/^\/uploads\/avatars\/[A-Za-z0-9_-]+\.webp$/.test(String(finalized.avatar || '')), 'Avatar URL is unsafe');
        const avatarResponse = await fetch(new URL(finalized.avatar, `${baseUrl}/`));
        assert(avatarResponse.status === 200, 'Finalized avatar is not readable');
        assert(/^image\/webp\b/i.test(String(avatarResponse.headers.get('content-type') || '')), 'Finalized avatar is not WebP');
        printStep('avatar.scan-normalize-s3');
    }

    console.log('ACCOUNT_CENTER_STAGING_SMOKE_PASS');
};

if (require.main === module) {
    run().catch((error) => {
        console.error(`Account Center staging smoke failed: ${String(error?.message || 'unknown').slice(0, 500)}`);
        process.exitCode = 1;
    });
}

module.exports = {
    allowedSessionFields,
    assertAvatarScanDisabledFailClosed,
    assertSafeSessionProjection,
    assertStagingTarget,
    classifyFailurePayload,
    isRetryableFirebaseNetworkError,
    run,
    shouldRetryIdempotentTransientFailure,
    shouldRetryRateLimitDependency,
};

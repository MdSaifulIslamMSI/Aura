const crypto = require('crypto');
const {
    buildDesktopOwnerAccessPayload,
    createDesktopOwnerAccessSignature,
    isDesktopOwnerAccessConfigured,
    resetDesktopOwnerAccessReplayCacheForTests,
    verifyDesktopOwnerAccessAssertion,
} = require('../services/desktopOwnerAccessService');

const buildEnv = (key = crypto.randomBytes(48).toString('base64url')) => ({
    AURA_DESKTOP_OWNER_ACCESS_ENABLED: 'true',
    AURA_DESKTOP_OWNER_ACCESS_KEY: key,
    AURA_DESKTOP_OWNER_FIREBASE_UID: 'owner-firebase-uid',
});

const buildAssertion = ({ env = buildEnv(), nowMs = Date.now(), requestId = crypto.randomUUID() } = {}) => {
    const issuedAt = new Date(nowMs).toISOString();
    const nonce = crypto.randomBytes(24).toString('base64url');
    const payload = buildDesktopOwnerAccessPayload({
        requestId,
        issuedAt,
        nonce,
    });
    const signature = createDesktopOwnerAccessSignature(payload, env.AURA_DESKTOP_OWNER_ACCESS_KEY);

    return {
        issuedAt,
        nonce,
        requestId,
        signature,
    };
};

const verifyAsync = (...args) => Promise.resolve().then(() => verifyDesktopOwnerAccessAssertion(...args));

describe('desktop owner access service', () => {
    beforeEach(() => {
        resetDesktopOwnerAccessReplayCacheForTests();
    });

    test('fails closed when disabled or missing owner binding', async () => {
        expect(isDesktopOwnerAccessConfigured({})).toBe(false);
        await expect(verifyAsync({}, { env: {} })).rejects.toMatchObject({
            code: 'DESKTOP_OWNER_ACCESS_NOT_CONFIGURED',
            statusCode: 503,
        });

        expect(isDesktopOwnerAccessConfigured({
            AURA_DESKTOP_OWNER_ACCESS_ENABLED: 'true',
            AURA_DESKTOP_OWNER_ACCESS_KEY: crypto.randomBytes(48).toString('base64url'),
        })).toBe(false);
    });

    test('verifies a fresh owner assertion and maps only to configured owner uid', async () => {
        const env = buildEnv();
        const nowMs = Date.now();
        const assertion = buildAssertion({ env, nowMs });

        const result = await verifyAsync(assertion, {
            env,
            now: () => nowMs + 1000,
        });

        expect(result.ownerUid).toBe('owner-firebase-uid');
        expect(result.keyFingerprint).toMatch(/^[a-f0-9]{16}$/);
    });

    test('is disabled unconditionally in production', async () => {
        const env = {
            ...buildEnv(),
            NODE_ENV: 'production',
        };

        expect(isDesktopOwnerAccessConfigured(env)).toBe(false);
        await expect(verifyAsync(buildAssertion({ env }), { env })).rejects.toMatchObject({
            code: 'DESKTOP_OWNER_ACCESS_DISABLED_IN_PRODUCTION',
            statusCode: 503,
        });
    });

    test('rejects tampered signatures and replayed assertions', async () => {
        const env = buildEnv();
        const nowMs = Date.now();
        const assertion = buildAssertion({ env, nowMs });

        await expect(verifyAsync({
            ...assertion,
            nonce: 'tampered-owner-access-nonce',
        }, {
            env,
            now: () => nowMs + 1000,
        })).rejects.toThrow(/could not be verified/);

        await verifyAsync(assertion, {
            env,
            now: () => nowMs + 1000,
        });
        await expect(verifyAsync(assertion, {
            env,
            now: () => nowMs + 2000,
        })).rejects.toMatchObject({ statusCode: 409 });
    });

    test('distributed replay protection survives a process-local cache reset', async () => {
        const env = {
            ...buildEnv(),
            REDIS_REQUIRED: 'true',
        };
        const nowMs = Date.now();
        const assertion = buildAssertion({ env, nowMs });
        const redisClient = {
            set: jest.fn()
                .mockResolvedValueOnce('OK')
                .mockResolvedValueOnce(null),
        };

        await expect(verifyAsync(assertion, {
            env,
            now: () => nowMs + 1000,
            redisClient,
        })).resolves.toMatchObject({ ownerUid: 'owner-firebase-uid' });

        resetDesktopOwnerAccessReplayCacheForTests();
        await expect(verifyAsync(assertion, {
            env,
            now: () => nowMs + 2000,
            redisClient,
        })).rejects.toMatchObject({ statusCode: 409 });
    });

    test('fails closed when production replay storage is unavailable', async () => {
        const env = {
            ...buildEnv(),
            REDIS_REQUIRED: 'true',
        };
        const assertion = buildAssertion({ env });
        const redisClient = {
            set: jest.fn().mockRejectedValue(new Error('redis unavailable')),
        };

        await expect(verifyAsync(assertion, { env, redisClient })).rejects.toMatchObject({
            code: 'DESKTOP_OWNER_ACCESS_REPLAY_UNAVAILABLE',
            statusCode: 503,
        });
    });
});

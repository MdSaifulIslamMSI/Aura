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

describe('desktop owner access service', () => {
    beforeEach(() => {
        resetDesktopOwnerAccessReplayCacheForTests();
    });

    test('fails closed when disabled or missing owner binding', () => {
        expect(isDesktopOwnerAccessConfigured({})).toBe(false);
        try {
            verifyDesktopOwnerAccessAssertion({}, { env: {} });
            throw new Error('expected owner access verification to fail');
        } catch (error) {
            expect(error).toMatchObject({
                code: 'DESKTOP_OWNER_ACCESS_NOT_CONFIGURED',
                statusCode: 503,
            });
        }

        expect(isDesktopOwnerAccessConfigured({
            AURA_DESKTOP_OWNER_ACCESS_ENABLED: 'true',
            AURA_DESKTOP_OWNER_ACCESS_KEY: crypto.randomBytes(48).toString('base64url'),
        })).toBe(false);
    });

    test('verifies a fresh owner assertion and maps only to configured owner uid', () => {
        const env = buildEnv();
        const nowMs = Date.now();
        const assertion = buildAssertion({ env, nowMs });

        const result = verifyDesktopOwnerAccessAssertion(assertion, {
            env,
            now: () => nowMs + 1000,
        });

        expect(result.ownerUid).toBe('owner-firebase-uid');
        expect(result.keyFingerprint).toMatch(/^[a-f0-9]{16}$/);
    });

    test('rejects tampered signatures and replayed assertions', () => {
        const env = buildEnv();
        const nowMs = Date.now();
        const assertion = buildAssertion({ env, nowMs });

        expect(() => verifyDesktopOwnerAccessAssertion({
            ...assertion,
            nonce: 'tampered-owner-access-nonce',
        }, {
            env,
            now: () => nowMs + 1000,
        })).toThrow(/could not be verified/);

        verifyDesktopOwnerAccessAssertion(assertion, {
            env,
            now: () => nowMs + 1000,
        });
        try {
            verifyDesktopOwnerAccessAssertion(assertion, {
                env,
                now: () => nowMs + 2000,
            });
            throw new Error('expected owner access replay to fail');
        } catch (error) {
            expect(error).toMatchObject({ statusCode: 409 });
        }
    });
});

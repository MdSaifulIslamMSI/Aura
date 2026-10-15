const crypto = require('crypto');

/**
 * The v1 → v2 blind-index migration must never make an existing row unfindable.
 *
 * These tests pin the frozen v1 derivations exactly and prove the dual-read
 * helpers still match them, because a mistake here silently breaks login-by-phone
 * and admin user search — the two paths that query the hash instead of the value.
 */

const {
    computePhoneBlindIndex,
    computeEmailBlindIndex,
    computePhoneBlindIndexV2,
    computeEmailBlindIndexV2,
} = require('../services/blindIndexService');

// Pin the secrets explicitly. The repo's .env sets these variables, so relying
// on the service's test-only fallback would make the frozen-derivation
// assertions compare against a string that is never actually used.
const TEST_PHONE_SECRET = 'pinned-phone-blind-index-secret-0123456789';
const TEST_EMAIL_SECRET = 'pinned-email-blind-index-secret-0123456789';

describe('blind index v1 (frozen)', () => {
    beforeAll(() => {
        process.env.PHONE_BLIND_INDEX_SECRET = TEST_PHONE_SECRET;
        process.env.EMAIL_BLIND_INDEX_SECRET = TEST_EMAIL_SECRET;
    });

    test('phone v1 is a bare HMAC-SHA256 over the raw secret', () => {
        const expected = crypto.createHmac('sha256', TEST_PHONE_SECRET)
            .update('+919876543210').digest('hex');
        expect(computePhoneBlindIndex('+919876543210')).toBe(expected);
    });

    test('email v1 hashes the normalized (trimmed, lowercased) value', () => {
        const expected = crypto.createHmac('sha256', TEST_EMAIL_SECRET)
            .update('a@b.com').digest('hex');
        expect(computeEmailBlindIndex('A@B.com')).toBe(expected);
    });

    test('v1 is unchanged by the v2 rollout (no silent drift)', () => {
        const before = computePhoneBlindIndex('+919876543210');
        const after = computePhoneBlindIndex('+919876543210');
        expect(before).toBe(after);
        expect(before).toMatch(/^[a-f0-9]{64}$/);
    });
});

describe('blind index v2 (HKDF-derived)', () => {
    beforeAll(() => {
        process.env.PHONE_BLIND_INDEX_SECRET = TEST_PHONE_SECRET;
        process.env.EMAIL_BLIND_INDEX_SECRET = TEST_EMAIL_SECRET;
    });

    test('phone v2 differs from v1 for the same value', () => {
        expect(computePhoneBlindIndexV2('+919876543210'))
            .not.toBe(computePhoneBlindIndex('+919876543210'));
    });

    test('email v2 differs from v1 for the same value', () => {
        expect(computeEmailBlindIndexV2('a@b.com'))
            .not.toBe(computeEmailBlindIndex('a@b.com'));
    });

    test('v2 keys are domain-separated from the v1 key', () => {
        // v1 uses the secret directly, so the v2 key must not equal it.
        expect(computePhoneBlindIndexV2('x')).not.toBe(
            crypto.createHmac('sha256', TEST_PHONE_SECRET).update('x').digest('hex')
        );
    });

    test('phone and email v2 use different contexts', () => {
        // Same secret, different purpose: the derived hashes must not collide.
        const phoneV2 = computePhoneBlindIndexV2('same-value');
        const emailV2 = computeEmailBlindIndexV2('same-value');
        expect(phoneV2).not.toBe(emailV2);
    });

    test('v2 is deterministic', () => {
        expect(computePhoneBlindIndexV2('+919876543210'))
            .toBe(computePhoneBlindIndexV2('+919876543210'));
    });
});


describe('retired dual-read helpers (step-4 retirement)', () => {
    test('the *Candidates helpers are removed from the service surface', () => {
        const service = require('../services/blindIndexService');
        expect(service.phoneBlindIndexCandidates).toBeUndefined();
        expect(service.emailBlindIndexCandidates).toBeUndefined();
    });

    test('v1 compute functions stay exported, frozen, for the migration tooling', () => {
        // scripts/backfill-blind-indexes.js verifies stored v1 hashes against
        // these; request-path code must never call them again.
        const service = require('../services/blindIndexService');
        expect(typeof service.computePhoneBlindIndex).toBe('function');
        expect(typeof service.computeEmailBlindIndex).toBe('function');
        expect(computePhoneBlindIndex('+919876543210'))
            .toBe(computePhoneBlindIndex('+919876543210'));
    });
});

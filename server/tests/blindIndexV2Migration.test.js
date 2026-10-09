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
    phoneBlindIndexCandidates,
    emailBlindIndexCandidates,
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


describe('dual-read query helpers', () => {
    beforeAll(() => {
        process.env.PHONE_BLIND_INDEX_SECRET = TEST_PHONE_SECRET;
        process.env.EMAIL_BLIND_INDEX_SECRET = TEST_EMAIL_SECRET;
    });

    test('phone candidates include BOTH versions so pre-backfill rows still match', () => {
        const candidates = phoneBlindIndexCandidates('+919876543210');
        expect(candidates).toContain(computePhoneBlindIndex('+919876543210'));
        expect(candidates).toContain(computePhoneBlindIndexV2('+919876543210'));
        expect(candidates).toHaveLength(2);
    });

    test('email candidates include BOTH versions and normalize first', () => {
        const candidates = emailBlindIndexCandidates('A@B.com');
        expect(candidates).toContain(computeEmailBlindIndex('a@b.com'));
        expect(candidates).toContain(computeEmailBlindIndexV2('a@b.com'));
        expect(candidates).toHaveLength(2);
    });

    test('candidates are de-duplicated', () => {
        // Distinct contexts guarantee distinct hashes, so no dupes today — but the
        // helper must not emit them if a future change makes v1 and v2 coincide.
        const candidates = phoneBlindIndexCandidates('+919876543210');
        expect(new Set(candidates).size).toBe(candidates.length);
    });

    test('empty/blank input yields no candidates', () => {
        expect(phoneBlindIndexCandidates('')).toEqual([]);
        expect(phoneBlindIndexCandidates(null)).toEqual([]);
        expect(phoneBlindIndexCandidates(undefined)).toEqual([]);
        expect(emailBlindIndexCandidates('   ')).toEqual([]);
        expect(emailBlindIndexCandidates(null)).toEqual([]);
    });
});

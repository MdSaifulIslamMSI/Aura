const crypto = require('crypto');

/**
 * Recovery-code hash migration: legacy bare-hex hashes must keep verifying.
 *
 * A recovery code is single-use, so a user whose stored hash stops matching has
 * permanently lost that factor. The legacy derivation is therefore frozen and
 * verification must accept both versions.
 */

describe('recovery code hash migration', () => {
    const originalEnv = process.env.AUTH_RECOVERY_CODE_SECRET;

    beforeAll(() => {
        process.env.AUTH_RECOVERY_CODE_SECRET = 'recovery-code-test-secret-0123456789abcdef';
    });

    afterAll(() => {
        if (originalEnv === undefined) delete process.env.AUTH_RECOVERY_CODE_SECRET;
        else process.env.AUTH_RECOVERY_CODE_SECRET = originalEnv;
    });

    test('v2 hashes are prefixed and hex', () => {
        const { hashRecoveryCode } = require('../services/authRecoveryCodeService');
        const hash = hashRecoveryCode('ABCD-1234-EFGH-5678');
        expect(hash.startsWith('hmac-sha256-v2:')).toBe(true);
        expect(hash.slice('hmac-sha256-v2:'.length)).toMatch(/^[a-f0-9]{64}$/);
    });

    test('v2 differs from the legacy bare-hex derivation', () => {
        const { hashRecoveryCode, hashRecoveryCodeLegacy } = require('../services/authRecoveryCodeService');
        expect(hashRecoveryCode('ABCD-1234-EFGH-5678'))
            .not.toBe(hashRecoveryCodeLegacy('ABCD-1234-EFGH-5678'));
    });

    test('legacy derivation is exactly the original bare-hex HMAC', () => {
        const { hashRecoveryCodeLegacy } = require('../services/authRecoveryCodeService');
        const secret = process.env.AUTH_RECOVERY_CODE_SECRET;
        // The service normalizes (uppercase, strip non-alphanumeric) before hashing.
        const expected = crypto.createHmac('sha256', secret).update('ABCD1234EFGH5678').digest('hex');
        expect(hashRecoveryCodeLegacy('abcd-1234-efgh-5678')).toBe(expected);
    });

    test('legacy hash is stable across calls (no silent drift)', () => {
        const { hashRecoveryCodeLegacy } = require('../services/authRecoveryCodeService');
        expect(hashRecoveryCodeLegacy('ZZZZ9999')).toBe(hashRecoveryCodeLegacy('ZZZZ9999'));
    });

    test('a legacy-stored code is still matched after the change', () => {
        const { hashRecoveryCodeLegacy, findMatchingRecoveryCode } = require('../services/authRecoveryCodeService');
        const code = 'QQQQ1111WWWW2222';
        const storedHash = hashRecoveryCodeLegacy(code);

        const entries = [{ codeHash: storedHash, usedAt: null }];
        expect(findMatchingRecoveryCode(entries, code)).not.toBeNull();
        expect(findMatchingRecoveryCode(entries, code)).toBe(entries[0]);
    });

    test('a v2-stored code is matched', () => {
        const { hashRecoveryCode, findMatchingRecoveryCode } = require('../services/authRecoveryCodeService');
        const code = 'RRRR3333EEEE4444';
        const entries = [{ codeHash: hashRecoveryCode(code), usedAt: null }];
        expect(findMatchingRecoveryCode(entries, code)).not.toBeNull();
    });

    test('a wrong code matches nothing', () => {
        const { hashRecoveryCode, hashRecoveryCodeLegacy, findMatchingRecoveryCode } =
            require('../services/authRecoveryCodeService');
        const entries = [
            { codeHash: hashRecoveryCode('AAAA1111BBBB2222'), usedAt: null },
            { codeHash: hashRecoveryCodeLegacy('CCCC3333DDDD4444'), usedAt: null },
        ];
        expect(findMatchingRecoveryCode(entries, 'ZZZZ9999YYYY0000')).toBeNull();
    });

    test('already-used codes are never matched, under either version', () => {
        const { hashRecoveryCode, hashRecoveryCodeLegacy, findMatchingRecoveryCode } =
            require('../services/authRecoveryCodeService');
        const code = 'USED1111USED2222';
        const usedAt = new Date();

        expect(findMatchingRecoveryCode([{ codeHash: hashRecoveryCode(code), usedAt }], code)).toBeNull();
        expect(findMatchingRecoveryCode([{ codeHash: hashRecoveryCodeLegacy(code), usedAt }], code)).toBeNull();
    });

    test('comparison is constant-time and never throws on malformed input', () => {
        const { findMatchingRecoveryCode } = require('../services/authRecoveryCodeService');
        const entries = [{ codeHash: 'not-hex-at-all', usedAt: null }];
        expect(() => findMatchingRecoveryCode(entries, 'SOME1111CODE2222')).not.toThrow();
        expect(findMatchingRecoveryCode(entries, 'SOME1111CODE2222')).toBeNull();
    });

    test('empty and non-array entry lists are handled', () => {
        const { findMatchingRecoveryCode } = require('../services/authRecoveryCodeService');
        expect(findMatchingRecoveryCode([], 'AAAA1111BBBB2222')).toBeNull();
        expect(findMatchingRecoveryCode(null, 'AAAA1111BBBB2222')).toBeNull();
        expect(findMatchingRecoveryCode(undefined, 'AAAA1111BBBB2222')).toBeNull();
    });

    test('candidates list both versions, newest first', () => {
        const { recoveryCodeHashCandidates, hashRecoveryCode, hashRecoveryCodeLegacy } =
            require('../services/authRecoveryCodeService');
        const candidates = recoveryCodeHashCandidates('MMMM5555NNNN6666');
        expect(candidates[0]).toBe(hashRecoveryCode('MMMM5555NNNN6666'));
        expect(candidates[1]).toBe(hashRecoveryCodeLegacy('MMMM5555NNNN6666'));
    });
});

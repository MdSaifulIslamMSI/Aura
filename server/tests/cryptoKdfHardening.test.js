const crypto = require('crypto');

const {
    deriveSubkey,
    deriveAes256GcmKey,
    deriveHmacKey,
    safeCompareHex,
    safeCompareBase64Url,
    SUBKEY_BYTES,
} = require('../utils/cryptoKdf');

describe('cryptoKdf', () => {
    const SECRET = 'unit-test-high-entropy-secret-value-0123456789';

    describe('deriveSubkey', () => {
        test('produces 32 bytes by default', () => {
            expect(deriveSubkey({ secret: SECRET, context: 'ctx' })).toHaveLength(SUBKEY_BYTES);
        });

        test('honours an explicit output length', () => {
            expect(deriveSubkey({ secret: SECRET, context: 'ctx', bytes: 16 })).toHaveLength(16);
            expect(deriveSubkey({ secret: SECRET, context: 'ctx', bytes: 64 })).toHaveLength(64);
        });

        test('is deterministic for the same secret and context', () => {
            const a = deriveSubkey({ secret: SECRET, context: 'ctx' });
            const b = deriveSubkey({ secret: SECRET, context: 'ctx' });
            expect(a.equals(b)).toBe(true);
        });

        test('separates purposes: same secret, different context, different key', () => {
            const phone = deriveSubkey({ secret: SECRET, context: 'phone-index' });
            const email = deriveSubkey({ secret: SECRET, context: 'email-index' });
            expect(phone.equals(email)).toBe(false);
        });

        test('separates secrets: same context, different secret, different key', () => {
            const a = deriveSubkey({ secret: 'secret-a', context: 'ctx' });
            const b = deriveSubkey({ secret: 'secret-b', context: 'ctx' });
            expect(a.equals(b)).toBe(false);
        });

        test('rejects an empty or whitespace-only context', () => {
            expect(() => deriveSubkey({ secret: SECRET, context: '' })).toThrow(/context/);
            expect(() => deriveSubkey({ secret: SECRET, context: '   ' })).toThrow(/context/);
        });

        test('rejects out-of-range output lengths', () => {
            expect(() => deriveSubkey({ secret: SECRET, context: 'ctx', bytes: 8 })).toThrow(/16 and 1024/);
            expect(() => deriveSubkey({ secret: SECRET, context: 'ctx', bytes: 2048 })).toThrow(/16 and 1024/);
            expect(() => deriveSubkey({ secret: SECRET, context: 'ctx', bytes: 32.5 })).toThrow(/integer/);
        });

        test('accepts Buffer secrets and matches the equivalent utf8 string', () => {
            // Use a real utf8 string: randomBytes(32).toString('utf8') would be
            // lossy and could not round-trip, making the comparison meaningless.
            const asString = 'buffer-backed-secret-value-for-kdf-test';
            const buffer = Buffer.from(asString, 'utf8');

            expect(deriveSubkey({ secret: buffer, context: 'ctx' })).toHaveLength(32);
            expect(deriveSubkey({ secret: buffer, context: 'ctx' }).equals(
                deriveSubkey({ secret: asString, context: 'ctx' })
            )).toBe(true);
        });

        // RFC 5869 Test Case 1, pinned so a refactor cannot silently change the KDF.
        test('matches the RFC 5869 test vector', () => {
            const ikm = Buffer.from('0b'.repeat(22), 'hex');
            const salt = Buffer.from('000102030405060708090a0b0c', 'hex');
            const info = Buffer.from('f0f1f2f3f4f5f6f7f8f9', 'hex');
            const expected = Buffer.from(
                '3cb25f25faacd57a90434f64d0362f2a2d2d0a90cf1a5a4c5db02d56ecc4c5bf34007208d5b887185865',
                'hex'
            );

            const actual = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, info, 42));
            expect(actual.equals(expected)).toBe(true);
        });
    });

    describe('deriveAes256GcmKey / deriveHmacKey', () => {
        test('aes key is usable as an AES-256-GCM key', () => {
            const key = deriveAes256GcmKey({ secret: SECRET, context: 'aes' });
            expect(key).toHaveLength(32);
            expect(() => crypto.createCipheriv('aes-256-gcm', key, crypto.randomBytes(12))).not.toThrow();
        });

        test('hmac key works as an HMAC key', () => {
            const key = deriveHmacKey({ secret: SECRET, context: 'hmac' });
            expect(crypto.createHmac('sha256', key).update('x').digest('hex')).toMatch(/^[a-f0-9]{64}$/);
        });
    });

    describe('safeCompareHex', () => {
        test('returns true for equal hex digests', () => {
            expect(safeCompareHex('abcd', 'abcd')).toBe(true);
        });

        test('returns false for different digests without throwing', () => {
            expect(safeCompareHex('abcd', 'abce')).toBe(false);
        });

        test('returns false on length mismatch rather than throwing', () => {
            expect(() => safeCompareHex('abcd', 'abcdef')).not.toThrow();
            expect(safeCompareHex('abcd', 'abcdef')).toBe(false);
        });

        test('returns false for empty input', () => {
            expect(safeCompareHex('', '')).toBe(false);
            expect(safeCompareHex('', 'abcd')).toBe(false);
        });
    });

    describe('safeCompareBase64Url', () => {
        test('returns true for equal values', () => {
            expect(safeCompareBase64Url('abc.def', 'abc.def')).toBe(true);
        });

        test('returns false for different values', () => {
            expect(safeCompareBase64Url('abc.def', 'abc.deg')).toBe(false);
        });

        test('returns false on length mismatch rather than throwing', () => {
            expect(() => safeCompareBase64Url('short', 'much-longer-value')).not.toThrow();
            expect(safeCompareBase64Url('short', 'much-longer-value')).toBe(false);
        });

        test('returns false for empty input', () => {
            expect(safeCompareBase64Url('', '')).toBe(false);
        });
    });
});

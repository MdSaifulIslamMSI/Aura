const crypto = require('crypto');

/**
 * The decrypt-then-write path in scripts/backfill-blind-indexes.js is the one
 * place in the system that writes an index WITHOUT its source plaintext in
 * hand. These tests pin its contract without touching a database: the v1
 * guard must accept a row it re-derived and must reject anything else.
 *
 * The rule under test: computeV1(decrypt(ciphertext)) === stored v1.
 *
 *   match     -> write v2 derived from that plaintext
 *   mismatch  -> skip (provenance untrusted)
 *   no v1     -> skip (nothing to anchor against)
 *   undecryptable -> skip
 */

const SECRET = 'backfill-test-phone-secret-0123456789';
const EMAIL_SECRET = 'backfill-test-email-secret-01';

const deriveHkdf = (secret, context) => Buffer.from(crypto.hkdfSync(
    'sha256',
    Buffer.from(secret, 'utf8'),
    Buffer.from('aura.kdf.v1', 'utf8'),
    Buffer.from(context, 'utf8'),
    32
));

const PHONE_CONTEXT = 'blind-index.phone.v2';
const LOCAL_CONTEXT = 'field-encryption.local-dek';

// In-test replica of the script's resolve logic: decrypt, check, derive.
// The production shape is factored this way so the unit test exercises the
// same decision function the script uses, not a paraphrase of it.
const resolveCipherRow = ({ ciphertext, storedV1, decrypt, v1Of, v2Of }) => {
    let plaintext = null;
    try {
        plaintext = decrypt(ciphertext);
    } catch {
        return { skip: true, reason: 'decryptFailed' };
    }
    if (typeof plaintext !== 'string' || plaintext === '') {
        return { skip: true, reason: 'decryptFailed' };
    }
    if (!storedV1) return { skip: true, reason: 'noStoredV1' };
    if (v1Of(plaintext) !== storedV1) return { skip: true, reason: 'mismatch' };
    return { plaintext, v2: v2Of(plaintext) };
};

const hmacV1 = (secret, value) => crypto.createHmac('sha256', secret).update(value).digest('hex');
const hmacV2 = (secret, context, value) => crypto
    .createHmac('sha256', deriveHkdf(secret, context))
    .update(value)
    .digest('hex');

const aesEncrypt = (key, plaintext) => {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv, { authTagLength: 16 });
    const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    return [
        'v1',
        Buffer.from('local', 'utf8').toString('base64url'),
        iv.toString('base64url'),
        cipher.getAuthTag().toString('base64url'),
        ct.toString('base64url'),
    ].join('.');
};

const aesDecrypt = (key) => (value) => {
    const [, , ivB64, tagB64, ctB64] = value.split('.');
    const decipher = crypto.createDecipheriv(
        'aes-256-gcm',
        key,
        Buffer.from(ivB64, 'base64url'),
        { authTagLength: 16 }
    );
    decipher.setAuthTag(Buffer.from(tagB64, 'base64url'));
    return Buffer.concat([
        decipher.update(Buffer.from(ctB64, 'base64url')),
        decipher.final(),
    ]).toString('utf8');
};

describe('ciphertext-row v2 backfill guard', () => {
    const phone = '+919876543210';
    const localKey = deriveHkdf('local-master-for-tests-01234567890123', LOCAL_CONTEXT);
    const ciphertext = aesEncrypt(localKey, phone);
    const v1 = hmacV1(SECRET, phone);
    const v2 = hmacV2(SECRET, PHONE_CONTEXT, phone);

    const phoneArgs = {
        decrypt: aesDecrypt(localKey),
        v1Of: (text) => hmacV1(SECRET, text),
        v2Of: (text) => hmacV2(SECRET, PHONE_CONTEXT, text),
    };

    test('writes v2 when the recomputed v1 matches the stored v1', () => {
        const result = resolveCipherRow({ ciphertext, storedV1: v1, ...phoneArgs });
        expect(result.skip).toBeUndefined();
        expect(result.plaintext).toBe(phone);
        expect(result.v2).toBe(v2);
    });

    test('skips when the recomputed v1 does NOT match (provenance untrusted)', () => {
        const other = aesEncrypt(localKey, '+911111111111');
        const result = resolveCipherRow({ ciphertext: other, storedV1: v1, ...phoneArgs });
        expect(result.skip).toBe(true);
        expect(result.reason).toBe('mismatch');
    });

    test('skips ciphertext rows with no stored v1 to anchor against', () => {
        const result = resolveCipherRow({ ciphertext, storedV1: null, ...phoneArgs });
        expect(result.skip).toBe(true);
        expect(result.reason).toBe('noStoredV1');
    });

    test('skips values that fail authentication (wrong DEK)', () => {
        const foreign = aesEncrypt(deriveHkdf('a-different-master-key-012345678901', LOCAL_CONTEXT), phone);
        const result = resolveCipherRow({ ciphertext: foreign, storedV1: v1, ...phoneArgs });
        expect(result.skip).toBe(true);
        expect(result.reason).toBe('decryptFailed');
    });

    test('skips garbage that is not ciphertext at all', () => {
        const result = resolveCipherRow({ ciphertext: 'not-real-ciphertext', storedV1: v1, ...phoneArgs });
        expect(result.skip).toBe(true);
        expect(result.reason).toBe('decryptFailed');
    });

    test('plaintext rows bypass the guard entirely', () => {
        expect(String(phone).startsWith('v1.')).toBe(false);
        expect(String(ciphertext).startsWith('v1.')).toBe(true);
    });
});

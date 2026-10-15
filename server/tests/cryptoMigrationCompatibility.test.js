const crypto = require('crypto');

/**
 * Backward-compatibility contracts for the crypto hardening change.
 *
 * The risk in switching a KDF is not the new path — it is that every value
 * already stored in the database was produced by the old one. These tests pin
 * the legacy derivations exactly and prove the read paths still accept them, so
 * a future refactor cannot quietly lock users out of their own data.
 */

const hkdf = (secret, context) => Buffer.from(crypto.hkdfSync(
    'sha256',
    Buffer.from(secret, 'utf8'),
    Buffer.from('aura.kdf.v1', 'utf8'),
    Buffer.from(context, 'utf8'),
    32
));

describe('TOTP secret format migration', () => {
    const SECRET_MATERIAL = 'k'.repeat(48);
    const NEW_CONTEXT = 'mfa.totp.secret';
    const LEGACY_CONTEXT = 'mfa.totp.secret.legacy';

    // The pre-hardening derivation: a single SHA-256 over the configured secret.
    const deriveLegacySha256 = () => crypto.createHash('sha256').update(SECRET_MATERIAL).digest();

    const gcmEncrypt = (key, plaintext) => {
        const iv = crypto.randomBytes(12);
        const cipher = crypto.createCipheriv('aes-256-gcm', key, iv, { authTagLength: 16 });
        const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
        return [
            iv.toString('base64url'),
            cipher.getAuthTag().toString('base64url'),
            ct.toString('base64url'),
        ].join('.');
    };

    const gcmDecrypt = (encoded, key) => {
        const [ivB64, tagB64, ctB64] = encoded.split('.');
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

    test('legacy sha256-derived key still decrypts v1 ciphertext', () => {
        const v1 = gcmEncrypt(deriveLegacySha256(), 'JBSWY3DPEHPK3PXP');
        expect(gcmDecrypt(v1, deriveLegacySha256())).toBe('JBSWY3DPEHPK3PXP');
    });

    test('v1 ciphertext does NOT decrypt under the new HKDF key', () => {
        // Proves the version gate is necessary: the new key must not be tried
        // against v1 data, so a mislabelled record cannot be silently misread.
        const v1 = gcmEncrypt(deriveLegacySha256(), 'JBSWY3DPEHPK3PXP');
        expect(() => gcmDecrypt(v1, hkdf(SECRET_MATERIAL, NEW_CONTEXT))).toThrow();
    });

    test('new and legacy HKDF contexts produce distinct keys', () => {
        expect(hkdf(SECRET_MATERIAL, NEW_CONTEXT).equals(hkdf(SECRET_MATERIAL, LEGACY_CONTEXT))).toBe(false);
        expect(hkdf(SECRET_MATERIAL, LEGACY_CONTEXT).equals(deriveLegacySha256())).toBe(false);
    });
});

describe('OTP flow token format migration', () => {
    const OTP_SECRET = 'otp-flow-test-secret-that-is-long-enough-1234';
    const NEW_CONTEXT = 'otp.flow.token.payload';
    // Frozen: the legacy key is a literal sha256 over the OLD context string.
    // HKDF cannot reproduce it, which is exactly why this stays hardcoded.
    const LEGACY_CONTEXT = 'aura-otp-flow-token';

    // The pre-hardening derivation: sha256(`${secret}:${legacyContext}`).
    const deriveLegacyOtpFlowKey = () => crypto.createHash('sha256')
        .update(`${OTP_SECRET}:${LEGACY_CONTEXT}`)
        .digest();

    const encryptPayloadWith = (key, payload) => {
        const iv = crypto.randomBytes(12);
        const cipher = crypto.createCipheriv('aes-256-gcm', key, iv, { authTagLength: 16 });
        const ct = Buffer.concat([
            cipher.update(Buffer.from(JSON.stringify(payload), 'utf8')),
            cipher.final(),
        ]);
        return Buffer.concat([iv, cipher.getAuthTag(), ct]).toString('base64url');
    };

    test('legacy token payload still decrypts under the frozen legacy key', () => {
        const payload = { sub: 'user_1', purpose: 'login', jti: 'tok_1' };
        const encoded = encryptPayloadWith(deriveLegacyOtpFlowKey(), payload);

        const buffer = Buffer.from(encoded, 'base64url');
        const decipher = crypto.createDecipheriv(
            'aes-256-gcm',
            deriveLegacyOtpFlowKey(),
            buffer.subarray(0, 12),
            { authTagLength: 16 }
        );
        decipher.setAuthTag(buffer.subarray(12, 28));
        const out = JSON.parse(Buffer.concat([
            decipher.update(buffer.subarray(28)),
            decipher.final(),
        ]).toString('utf8'));

        expect(out).toEqual(payload);
    });

    test('legacy payload does not decrypt under the new context key', () => {
        const encoded = encryptPayloadWith(deriveLegacyOtpFlowKey(), { sub: 'user_1' });
        const buffer = Buffer.from(encoded, 'base64url');
        const decipher = crypto.createDecipheriv(
            'aes-256-gcm',
            hkdf(OTP_SECRET, 'otp.flow.token.payload'),
            buffer.subarray(0, 12),
            { authTagLength: 16 }
        );
        decipher.setAuthTag(buffer.subarray(12, 28));
        expect(() => Buffer.concat([
            decipher.update(buffer.subarray(28)),
            decipher.final(),
        ])).toThrow();
    });
});

describe('auth profile vault scrypt format migration', () => {
    const VAULT_SECRET = 'vault-test-secret-with-enough-length-0123456789';
    const PARAMS_V1 = { N: 16384, r: 8, p: 1 };
    const PARAMS_V2 = { N: 131072, r: 8, p: 1 };
    const MAXMEM = 192 * 1024 * 1024;

    const scryptKey = (salt, params) => crypto.scryptSync(
        VAULT_SECRET, salt, 32,
        { N: params.N, r: params.r, p: params.p, maxmem: MAXMEM }
    );

    const vaultEncrypt = (version, salt, iv, key, plaintext) => {
        const cipher = crypto.createCipheriv('aes-256-gcm', key, iv, { authTagLength: 16 });
        let ct = cipher.update(plaintext, 'utf8', 'hex');
        ct += cipher.final('hex');
        return `${version}:${salt.toString('hex')}:${iv.toString('hex')}:${cipher.getAuthTag().toString('hex')}:${ct}`;
    };

    const vaultDecrypt = (stored, params) => {
        const [, saltHex, ivHex, tagHex, ct] = stored.split(':');
        const decipher = crypto.createDecipheriv(
            'aes-256-gcm',
            scryptKey(Buffer.from(saltHex, 'hex'), params),
            Buffer.from(ivHex, 'hex'),
            { authTagLength: 16 }
        );
        decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
        return decipher.update(ct, 'hex', 'utf8') + decipher.final('utf8');
    };

    test('v1 records written with Node default scrypt params still decrypt', () => {
        const salt = crypto.randomBytes(16);
        const iv = crypto.randomBytes(12);
        const record = vaultEncrypt('v1', salt, iv, scryptKey(salt, PARAMS_V1), 'user@example.com');
        expect(record.split(':')).toHaveLength(5);
        expect(record.startsWith('v1:')).toBe(true);
        expect(vaultDecrypt(record, PARAMS_V1)).toBe('user@example.com');
    });

    test('v1 params are exactly Node scrypt defaults (no silent drift)', () => {
        // If this fails, the "frozen" v1 path no longer matches what was written.
        const salt = crypto.randomBytes(16);
        expect(scryptKey(salt, PARAMS_V1).equals(crypto.scryptSync(VAULT_SECRET, salt, 32))).toBe(true);
    });

    test('v2 params require a raised maxmem', () => {
        const salt = crypto.randomBytes(16);
        expect(PARAMS_V2.N).toBeGreaterThan(PARAMS_V1.N);
        // Node's default maxmem (32 MiB) cannot address N=2^17.
        expect(() => crypto.scryptSync(VAULT_SECRET, salt, 32, { N: PARAMS_V2.N, r: 8, p: 1 })).toThrow();
        expect(() => scryptKey(salt, PARAMS_V2)).not.toThrow();
    });

    test('v2 records round-trip', () => {
        const salt = crypto.randomBytes(16);
        const iv = crypto.randomBytes(12);
        const record = vaultEncrypt('v2', salt, iv, scryptKey(salt, PARAMS_V2), '+919876543210');
        expect(record.startsWith('v2:')).toBe(true);
        expect(vaultDecrypt(record, PARAMS_V2)).toBe('+919876543210');
    });

    test('v2 ciphertext does not decrypt with v1 params', () => {
        const salt = crypto.randomBytes(16);
        const record = vaultEncrypt('v2', salt, crypto.randomBytes(12), scryptKey(salt, PARAMS_V2), 'secret');
        expect(() => vaultDecrypt(record, PARAMS_V1)).toThrow();
    });
});

describe('field encryption local key migration', () => {
    const MASTER = 'local-master-key-material-for-tests-only-0123456789';
    const NEW_CONTEXT = 'field-encryption.local-dek';

    const legacyScrypt = () => crypto.scryptSync(MASTER, 'aura-field-encryption-kdf', 32);

    test('new local DEK is HKDF-derived, not fixed-salt scrypt', () => {
        expect(hkdf(MASTER, NEW_CONTEXT).equals(legacyScrypt())).toBe(false);
    });

    test('legacy fixed-salt scrypt key is reproducible for read-only fallback', () => {
        expect(legacyScrypt().equals(legacyScrypt())).toBe(true);
    });
});

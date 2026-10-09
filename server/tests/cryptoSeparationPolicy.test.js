const {
    DEDICATED_SECRETS,
    inspectCryptoSeparation,
    assertCryptoSeparationConfig,
} = require('../config/cryptoSeparationPolicy');

const STRONG = 'a'.repeat(48);

const fullEnv = () => DEDICATED_SECRETS.reduce((acc, entry) => {
    acc[entry.variable] = STRONG;
    return acc;
}, {});

describe('cryptoSeparationPolicy', () => {
    const originalNodeEnv = process.env.NODE_ENV;

    afterEach(() => {
        process.env.NODE_ENV = originalNodeEnv;
    });

    describe('inspectCryptoSeparation', () => {
        test('reports ok when every purpose has a dedicated secret', () => {
            const report = inspectCryptoSeparation(fullEnv());
            expect(report.ok).toBe(true);
            expect(report.missing).toEqual([]);
            expect(report.shared).toEqual([]);
            expect(report.collisions).toEqual([]);
        });

        test('flags a purpose that is borrowing a shared secret', () => {
            const env = fullEnv();
            delete env.PHONE_BLIND_INDEX_SECRET;
            env.OTP_FLOW_SECRET = STRONG;

            const report = inspectCryptoSeparation(env);
            expect(report.ok).toBe(false);
            expect(report.shared).toHaveLength(1);
            expect(report.shared[0]).toContain('PHONE_BLIND_INDEX_SECRET');
            expect(report.collisions[0]).toEqual({
                variable: 'PHONE_BLIND_INDEX_SECRET',
                with: 'OTP_FLOW_SECRET',
            });
        });

        test('flags a purpose with no secret at all as missing', () => {
            const env = fullEnv();
            delete env.OTP_HASH_SECRET;
            delete env.OTP_FLOW_SECRET;
            delete env.JWT_SECRET;

            const report = inspectCryptoSeparation(env);
            expect(report.ok).toBe(false);
            expect(report.missing).toContain('OTP_HASH_SECRET');
        });

        test('treats whitespace-only values as unset', () => {
            const env = fullEnv();
            env.EMAIL_BLIND_INDEX_SECRET = '   ';
            delete env.OTP_FLOW_SECRET;
            delete env.JWT_SECRET;

            const report = inspectCryptoSeparation(env);
            expect(report.missing).toContain('EMAIL_BLIND_INDEX_SECRET');
        });

        test('does not require the MFA key when TOTP is disabled', () => {
            const env = fullEnv();
            delete env.MFA_SECRET_ENCRYPTION_KEY;
            env.MFA_TOTP_ENABLED = 'false';

            expect(inspectCryptoSeparation(env).ok).toBe(true);
        });

        test('requires the MFA key when TOTP is enabled', () => {
            const env = fullEnv();
            delete env.MFA_SECRET_ENCRYPTION_KEY;
            env.MFA_TOTP_ENABLED = 'true';

            expect(inspectCryptoSeparation(env).missing).toContain('MFA_SECRET_ENCRYPTION_KEY');
        });
    });

    describe('assertCryptoSeparationConfig', () => {
        test('is a no-op outside production', () => {
            process.env.NODE_ENV = 'development';
            // Empty env would be a hard failure in production.
            expect(() => assertCryptoSeparationConfig({})).not.toThrow();
        });

        test('passes in production when fully configured', () => {
            process.env.NODE_ENV = 'production';
            expect(() => assertCryptoSeparationConfig(fullEnv())).not.toThrow();
        });

        test('throws in production when secrets are missing', () => {
            process.env.NODE_ENV = 'production';
            expect(() => assertCryptoSeparationConfig({}))
                .toThrow(/Cryptographic secrets are not configured/);
        });

        test('throws in production when a purpose shares another secret', () => {
            process.env.NODE_ENV = 'production';
            const env = fullEnv();
            delete env.OTP_HASH_SECRET;
            env.OTP_FLOW_SECRET = STRONG;

            expect(() => assertCryptoSeparationConfig(env))
                .toThrow(/share key material/);
        });
    });
});

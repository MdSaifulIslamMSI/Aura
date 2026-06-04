require('../index');

const User = require('../models/User');
const {
    beginTotpSetup,
    decryptTotpSecret,
    enableTotpAfterVerification,
    generateTotpCode,
    verifyEnabledTotpForUser,
} = require('../services/totpMfaService');

const strongSecret = 'testMfaEncryptionKey32CharactersPlusA1';
const recoverySecret = 'test-recovery-secret-32-characters-plus';

describe('totpMfaService', () => {
    const originalEnv = { ...process.env };

    beforeEach(() => {
        process.env = {
            ...originalEnv,
            NODE_ENV: 'test',
            MFA_ENABLED: 'true',
            MFA_TOTP_ENABLED: 'true',
            MFA_RECOVERY_CODES_ENABLED: 'true',
            MFA_SECRET_ENCRYPTION_KEY: strongSecret,
            AUTH_RECOVERY_CODE_SECRET: recoverySecret,
        };
    });

    afterEach(() => {
        process.env = { ...originalEnv };
    });

    test('stores TOTP secret encrypted and enables only after verification', async () => {
        const user = await User.create({
            name: 'TOTP User',
            email: 'totp-user@example.test',
            isVerified: true,
        });

        const setup = await beginTotpSetup({ userId: user._id });

        expect(setup.manualKey).toEqual(expect.any(String));
        expect(setup.otpauthUri).toContain('otpauth://totp/');
        expect(setup.qrCodeDataUrl).toMatch(/^data:image\/png;base64,/);

        const defaultProjection = await User.findById(user._id).lean();
        expect(defaultProjection.mfa?.totp?.secretEncrypted).toBeUndefined();
        expect(defaultProjection.mfa?.totp?.pendingSecretEncrypted).toBeUndefined();

        const withSecret = await User.findById(user._id)
            .select('+mfa.totp.pendingSecretEncrypted +mfa.totp.secretEncrypted')
            .lean();
        expect(withSecret.mfa.totp.pendingSecretEncrypted).not.toBe(setup.manualKey);
        expect(withSecret.mfa.totp.secretEncrypted).toBeNull();

        const code = generateTotpCode({
            secret: decryptTotpSecret(withSecret.mfa.totp.pendingSecretEncrypted),
        });
        const result = await enableTotpAfterVerification({
            userId: user._id,
            code,
        });

        expect(result.user.mfa.totp.enabled).toBe(true);
        expect(result.recoveryCodes).toHaveLength(10);

        const enabled = await User.findById(user._id)
            .select('+mfa.totp.secretEncrypted +recoveryCodes')
            .lean();
        expect(enabled.mfa.totp.secretEncrypted).not.toContain(setup.manualKey);
        expect(enabled.recoveryCodes[0].codeHash).not.toBe(result.recoveryCodes[0]);

        const loginCode = generateTotpCode({
            secret: decryptTotpSecret(enabled.mfa.totp.secretEncrypted),
        });
        const verified = await verifyEnabledTotpForUser({
            userId: user._id,
            code: loginCode,
        });

        expect(verified.mfa.lastMfaMethod).toBe('totp');
        expect(verified.mfa.lastMfaAt).toBeInstanceOf(Date);
    });
});

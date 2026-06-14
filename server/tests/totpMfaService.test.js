require('../index');

const User = require('../models/User');
const {
    beginTotpSetup,
    decryptTotpSecret,
    disableTotpAfterFreshMfa,
    enableTotpAfterVerification,
    encryptTotpSecret,
    generateTotpCode,
    generateTotpSecret,
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

    test('refuses to disable TOTP with only low-assurance MFA evidence and leaves factor intact', async () => {
        const encryptedSecret = encryptTotpSecret(generateTotpSecret());
        const recentLowAssuranceMfa = new Date();
        const user = await User.create({
            name: 'TOTP Disable User',
            email: 'totp-disable-low-assurance@example.test',
            isVerified: true,
            recoveryCodeState: { activeCount: 1 },
            mfa: {
                enabled: true,
                defaultMethod: 'totp',
                totp: {
                    enabled: true,
                    secretEncrypted: encryptedSecret,
                    confirmedAt: new Date('2026-06-04T00:00:00.000Z'),
                    disabledAt: null,
                },
                lastMfaAt: recentLowAssuranceMfa,
                lastMfaMethod: 'email_otp',
            },
        });

        await expect(disableTotpAfterFreshMfa({ userId: user._id }))
            .rejects
            .toMatchObject({
                statusCode: 403,
                code: 'FRESH_MFA_REQUIRED',
            });

        const persisted = await User.findById(user._id)
            .select('+mfa.totp.secretEncrypted')
            .lean();

        expect(persisted.mfa.totp.enabled).toBe(true);
        expect(persisted.mfa.totp.disabledAt).toBeNull();
        expect(persisted.mfa.totp.secretEncrypted).toBe(encryptedSecret);
        expect(persisted.mfa.lastMfaMethod).toBe('email_otp');
        expect(persisted.mfa.lastMfaAt).toEqual(recentLowAssuranceMfa);
    });

    test('disables TOTP after fresh TOTP verification without changing recovery state', async () => {
        const encryptedSecret = encryptTotpSecret(generateTotpSecret());
        const freshTotpAt = new Date();
        const user = await User.create({
            name: 'TOTP Disable Fresh User',
            email: 'totp-disable-fresh@example.test',
            isVerified: true,
            recoveryCodeState: { activeCount: 3 },
            mfa: {
                enabled: true,
                defaultMethod: 'totp',
                totp: {
                    enabled: true,
                    secretEncrypted: encryptedSecret,
                    confirmedAt: new Date('2026-06-04T00:00:00.000Z'),
                    disabledAt: null,
                },
                lastMfaAt: freshTotpAt,
                lastMfaMethod: 'totp',
            },
        });

        const result = await disableTotpAfterFreshMfa({ userId: user._id });

        expect(result.mfa.totp.enabled).toBe(false);
        expect(result.mfa.totp.disabledAt).toBeInstanceOf(Date);
        expect(result.recoveryCodeState.activeCount).toBe(3);

        const persisted = await User.findById(user._id)
            .select('+mfa.totp.secretEncrypted')
            .lean();

        expect(persisted.mfa.totp.enabled).toBe(false);
        expect(persisted.mfa.totp.secretEncrypted).toBeUndefined();
        expect(persisted.recoveryCodeState.activeCount).toBe(3);
        expect(persisted.mfa.lastMfaMethod).toBe('totp');
        expect(persisted.mfa.lastMfaAt).toEqual(freshTotpAt);
    });
});

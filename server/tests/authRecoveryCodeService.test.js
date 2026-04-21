require('../index');

const User = require('../models/User');
const {
    consumeRecoveryCodeForPasswordReset,
    generateRecoveryCodesForUser,
    getRecoveryReadiness,
    hashRecoveryCode,
} = require('../services/authRecoveryCodeService');

const buildRuntimeSecret = (label = 'secret') => `${label}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

const createPasskeyUser = async (overrides = {}) => User.create({
    name: 'Recovery Ready User',
    email: `${buildRuntimeSecret('recovery-user')}@test.com`,
    phone: '+919876543210',
    isVerified: true,
    trustedDevices: [{
        deviceId: buildRuntimeSecret('passkey-device'),
        label: 'Passkey',
        method: 'webauthn',
        publicKeySpkiBase64: Buffer.from(buildRuntimeSecret('spki')).toString('base64'),
        webauthnCredentialIdBase64Url: buildRuntimeSecret('credential'),
        createdAt: new Date(),
        lastSeenAt: new Date(),
        lastVerifiedAt: new Date(),
    }],
    ...overrides,
});

describe('authRecoveryCodeService', () => {
    const originalRecoveryCodeSecret = process.env.AUTH_RECOVERY_CODE_SECRET;

    beforeEach(() => {
        process.env.AUTH_RECOVERY_CODE_SECRET = buildRuntimeSecret('recovery-code-secret');
    });

    afterEach(() => {
        process.env.AUTH_RECOVERY_CODE_SECRET = originalRecoveryCodeSecret;
    });

    test('generates hashed one-time backup codes only after passkey enrollment', async () => {
        const user = await createPasskeyUser();

        const result = await generateRecoveryCodesForUser({ userId: user._id });

        expect(result.codes).toHaveLength(10);
        expect(result.recoveryCodeState.activeCount).toBe(10);
        expect(result.readiness).toMatchObject({
            hasPasskey: true,
            passkeyRecoveryReady: true,
            shouldEnrollRecoveryCodes: false,
        });

        const defaultProjection = await User.findById(user._id).lean();
        expect(defaultProjection.recoveryCodes).toBeUndefined();

        const withSecrets = await User.findById(user._id).select('+recoveryCodes').lean();
        expect(withSecrets.recoveryCodes).toHaveLength(10);
        expect(withSecrets.recoveryCodes[0].codeHash).toBe(hashRecoveryCode(result.codes[0]));
        expect(withSecrets.recoveryCodes[0].codeHash).not.toBe(result.codes[0]);
    });

    test('consumes a recovery code once and issues password-reset readiness', async () => {
        const user = await createPasskeyUser();
        const { codes } = await generateRecoveryCodesForUser({ userId: user._id });

        const result = await consumeRecoveryCodeForPasswordReset({
            email: user.email,
            code: codes[0].toLowerCase(),
        });

        expect(result.user._id.toString()).toBe(user._id.toString());
        expect(result.recoveryCodeState.activeCount).toBe(9);
        expect(result.recoveryCodeState.lastUsedAt).toBeInstanceOf(Date);

        const updated = await User.findById(user._id).select('+recoveryCodes +resetOtpVerifiedAt').lean();
        expect(updated.resetOtpVerifiedAt).toBeInstanceOf(Date);
        expect(updated.recoveryCodes.filter((entry) => entry.usedAt)).toHaveLength(1);

        await expect(consumeRecoveryCodeForPasswordReset({
            email: user.email,
            code: codes[0],
        })).rejects.toMatchObject({
            message: 'Recovery code is invalid or already used.',
            statusCode: 401,
        });
    });

    test('marks passkey users without backup codes as needing recovery enrollment', () => {
        const readiness = getRecoveryReadiness({
            trustedDevices: [{ method: 'webauthn' }],
            recoveryCodeState: { activeCount: 0 },
        });

        expect(readiness).toMatchObject({
            hasPasskey: true,
            passkeyRecoveryReady: false,
            shouldEnrollRecoveryCodes: true,
        });
    });
});

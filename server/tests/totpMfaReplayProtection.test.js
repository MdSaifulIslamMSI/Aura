// Regression guard for TOTP time-step replay protection.
//
// A TOTP code was accepted for any step inside the +/-1 verification window
// and the accepted step was never persisted, so a captured code stayed
// replayable for roughly 90 seconds — long enough to mint a second session
// from a phished or shoulder-surfed code.
//
// These tests assert:
//   1. A code that was already accepted cannot be used again.
//   2. The next legitimate code (the following time step) still works.
//   3. The accepted time step is persisted on the user record.
//   4. The enrollment flow is NOT affected: enrolling with a code and then
//      logging in with the same code still works, because the enrollment
//      verification must not consume the step.
require('../index');

const User = require('../models/User');
const {
    decryptTotpSecret,
    enableTotpAfterVerification,
    generateTotpCode,
    getTotpTimeStep,
    verifyEnabledTotpForUser,
} = require('../services/totpMfaService');

jest.setTimeout(30000);

const strongSecret = 'testMfaEncryptionKey32CharactersPlusA1';
const recoverySecret = 'test-recovery-secret-32-characters-plus';
const TOTP_PERIOD_SECONDS = 30;

describe('totp replay protection', () => {
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

    const createTotpUser = async (email) => {
        const user = await User.create({
            name: 'TOTP Replay User',
            email,
            isVerified: true,
            recoveryCodeState: { activeCount: 1 },
        });

        await require('../services/totpMfaService').beginTotpSetup({ userId: user._id });
        const pending = await User.findById(user._id)
            .select('+mfa.totp.pendingSecretEncrypted')
            .lean();
        const pendingSecret = decryptTotpSecret(pending.mfa.totp.pendingSecretEncrypted);

        const code = generateTotpCode({ secret: pendingSecret });
        await enableTotpAfterVerification({ userId: user._id, code });

        const enabled = await User.findById(user._id)
            .select('+mfa.totp.secretEncrypted')
            .lean();

        return {
            user,
            secret: decryptTotpSecret(enabled.mfa.totp.secretEncrypted),
        };
    };

    test('a code that was already accepted is rejected on replay', async () => {
        const { user, secret } = await createTotpUser('totp-replay@example.test');

        const code = generateTotpCode({ secret });
        const first = await verifyEnabledTotpForUser({ userId: user._id, code });
        expect(first.mfa.lastMfaMethod).toBe('totp');

        await expect(verifyEnabledTotpForUser({ userId: user._id, code }))
            .rejects
            .toMatchObject({ statusCode: 401 });
    });

    test('the accepted time step is persisted on the user record', async () => {
        const { user, secret } = await createTotpUser('totp-replay-step@example.test');

        const code = generateTotpCode({ secret });
        const expectedStep = getTotpTimeStep();

        await verifyEnabledTotpForUser({ userId: user._id, code });

        const persisted = await User.findById(user._id).lean();
        expect(persisted.mfa.totp.lastUsedTimeStep).toBeGreaterThanOrEqual(expectedStep);
    });

    test('a legitimately new code still works after a replay was refused', async () => {
        const { user, secret } = await createTotpUser('totp-replay-next@example.test');

        const code = generateTotpCode({ secret });
        await verifyEnabledTotpForUser({ userId: user._id, code });

        await expect(verifyEnabledTotpForUser({ userId: user._id, code }))
            .rejects
            .toMatchObject({ statusCode: 401 });

        // The next time step is a different code and must still be accepted.
        const nextCode = generateTotpCode({
            secret,
            timestamp: Date.now() + (TOTP_PERIOD_SECONDS * 1000),
        });
        const verified = await verifyEnabledTotpForUser({ userId: user._id, code: nextCode });
        expect(verified.mfa.lastMfaMethod).toBe('totp');
    });

    test('an older code from a previous step is rejected after a newer one was used', async () => {
        const { user, secret } = await createTotpUser('totp-replay-old@example.test');

        const currentCode = generateTotpCode({ secret });
        await verifyEnabledTotpForUser({ userId: user._id, code: currentCode });

        const previousCode = generateTotpCode({
            secret,
            timestamp: Date.now() - (TOTP_PERIOD_SECONDS * 1000),
        });

        await expect(verifyEnabledTotpForUser({ userId: user._id, code: previousCode }))
            .rejects
            .toMatchObject({ statusCode: 401 });
    });

    test('enrolling and then logging in with the same code still works', async () => {
        // The enrollment verification must not consume the time step, otherwise
        // the very first login after enrollment would be refused as a replay.
        const user = await User.create({
            name: 'TOTP Enroll Then Login',
            email: 'totp-enroll-login@example.test',
            isVerified: true,
            recoveryCodeState: { activeCount: 1 },
        });

        const { beginTotpSetup } = require('../services/totpMfaService');
        await beginTotpSetup({ userId: user._id });
        const pending = await User.findById(user._id)
            .select('+mfa.totp.pendingSecretEncrypted')
            .lean();
        const pendingSecret = decryptTotpSecret(pending.mfa.totp.pendingSecretEncrypted);

        const code = generateTotpCode({ secret: pendingSecret });
        await enableTotpAfterVerification({ userId: user._id, code });

        const enabled = await User.findById(user._id)
            .select('+mfa.totp.secretEncrypted')
            .lean();
        const activeSecret = decryptTotpSecret(enabled.mfa.totp.secretEncrypted);

        const loginCode = generateTotpCode({ secret: activeSecret });
        const verified = await verifyEnabledTotpForUser({ userId: user._id, code: loginCode });
        expect(verified.mfa.lastMfaMethod).toBe('totp');
    });

    test('a wrong code is still rejected as invalid', async () => {
        const { user } = await createTotpUser('totp-replay-wrong@example.test');

        await expect(verifyEnabledTotpForUser({ userId: user._id, code: '000000' }))
            .rejects
            .toMatchObject({ statusCode: 401 });
    });
});

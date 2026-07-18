const {
    clearMfaChallengeMemory,
    consumeMfaChallenge,
    createMfaChallenge,
    inspectMfaChallenge,
} = require('../services/mfaChallengeService');

describe('mfaChallengeService', () => {
    const user = { _id: 'user-1' };

    beforeEach(() => {
        clearMfaChallengeMemory();
        process.env.NODE_ENV = 'test';
        process.env.MFA_CHALLENGE_TTL_SECONDS = '60';
    });

    afterEach(() => {
        clearMfaChallengeMemory();
        jest.restoreAllMocks();
        delete process.env.MFA_CHALLENGE_TTL_SECONDS;
    });

    test('creates and consumes a one-time MFA challenge', async () => {
        const challenge = await createMfaChallenge({
            user,
            purpose: 'login',
            policy: {
                allowedMethods: ['totp', 'recovery_code'],
                preferredMethod: 'totp',
                reason: 'user_enabled',
            },
            req: { headers: { 'user-agent': 'jest' }, ip: '127.0.0.1' },
        });

        expect(challenge).toMatchObject({
            purpose: 'login',
            allowedMethods: ['totp', 'recovery_code'],
            preferredMethod: 'totp',
        });

        await expect(inspectMfaChallenge({
            challengeId: challenge.challengeId,
            userId: user._id,
            method: 'totp',
            purpose: 'login',
        })).resolves.toMatchObject({ success: true });

        await expect(consumeMfaChallenge({
            challengeId: challenge.challengeId,
            userId: user._id,
            method: 'totp',
            purpose: 'login',
        })).resolves.toMatchObject({ success: true });

        await expect(consumeMfaChallenge({
            challengeId: challenge.challengeId,
            userId: user._id,
            method: 'totp',
            purpose: 'login',
        })).resolves.toMatchObject({ success: false });
    });

    test('rejects expired and wrong-method challenges', async () => {
        let now = new Date('2026-06-04T00:00:00.000Z').getTime();
        jest.spyOn(Date, 'now').mockImplementation(() => now);

        const challenge = await createMfaChallenge({
            user,
            purpose: 'login',
            policy: {
                allowedMethods: ['totp'],
                preferredMethod: 'totp',
            },
        });

        await expect(inspectMfaChallenge({
            challengeId: challenge.challengeId,
            userId: user._id,
            method: 'recovery_code',
            purpose: 'login',
        })).resolves.toMatchObject({ success: false, reason: 'method_not_allowed' });

        now += 61_000;

        await expect(inspectMfaChallenge({
            challengeId: challenge.challengeId,
            userId: user._id,
            method: 'totp',
            purpose: 'login',
        })).resolves.toMatchObject({ success: false, reason: 'expired' });
    });

    test('binds a login MFA challenge to the verified device session', async () => {
        const challenge = await createMfaChallenge({
            user,
            purpose: 'login',
            policy: {
                allowedMethods: ['totp'],
                preferredMethod: 'totp',
            },
            req: {
                headers: {
                    'x-aura-device-id': 'device-original',
                    'x-aura-device-session': 'device-session-original',
                },
            },
        });

        expect(challenge).not.toHaveProperty('deviceIdHash');
        expect(challenge).not.toHaveProperty('deviceSessionHash');

        await expect(inspectMfaChallenge({
            challengeId: challenge.challengeId,
            userId: user._id,
            method: 'totp',
            purpose: 'login',
            req: {
                headers: {
                    'x-aura-device-id': 'device-other',
                    'x-aura-device-session': 'device-session-original',
                },
            },
        })).resolves.toMatchObject({ success: false, reason: 'device_mismatch' });

        await expect(inspectMfaChallenge({
            challengeId: challenge.challengeId,
            userId: user._id,
            method: 'totp',
            purpose: 'login',
            req: {
                headers: {
                    'x-aura-device-id': 'device-original',
                    'x-aura-device-session': 'device-session-other',
                },
            },
        })).resolves.toMatchObject({ success: false, reason: 'device_session_mismatch' });

        await expect(consumeMfaChallenge({
            challengeId: challenge.challengeId,
            userId: user._id,
            method: 'totp',
            purpose: 'login',
            req: {
                headers: {
                    'x-aura-device-id': 'device-original',
                    'x-aura-device-session': 'device-session-original',
                },
            },
        })).resolves.toMatchObject({ success: true });
    });
});

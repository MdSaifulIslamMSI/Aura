const {
    cleanupExpiredChallenges,
    consumeChallenge,
    createChallenge,
    getChallenge,
    resetAlienOtpChallengeMemoryForTests,
    revokeUserChallenges,
    verifyChallengeShape,
} = require('../services/alienOtpChallengeService');

describe('ALIEN OTP challenge service', () => {
    beforeEach(() => {
        resetAlienOtpChallengeMemoryForTests();
    });

    test('creates a short-lived action-bound challenge', async () => {
        const challenge = await createChallenge({
            userId: 'user-1',
            tenantId: 'tenant-1',
            action: 'admin.refund.create',
            resourceId: 'refund-1',
            sessionId: 'session-1',
            deviceId: 'device-1',
            requestId: 'req-1',
            riskContext: { riskLevel: 'medium' },
        });

        expect(challenge.challengeId).toMatch(/^alien_ch_/);
        expect(challenge.nonce).toHaveLength(43);
        expect(challenge.used).toBe(false);
        expect(challenge.riskLevel).toBe('medium');
    });

    test('rejects wrong user, tenant, action, and resource binding', async () => {
        const challenge = await createChallenge({
            userId: 'user-1',
            tenantId: 'tenant-1',
            action: 'admin.user.disable',
            resourceId: 'user-2',
        });

        const result = await verifyChallengeShape({
            challengeId: challenge.challengeId,
            userId: 'user-2',
            tenantId: 'tenant-2',
            action: 'admin.role.update',
            resourceId: 'user-3',
        });

        expect(result.ok).toBe(false);
        expect(result.reasons).toEqual(expect.arrayContaining([
            'wrong_user',
            'wrong_tenant',
            'wrong_action',
            'wrong_resource',
        ]));
    });

    test('consumes once and rejects replay', async () => {
        const challenge = await createChallenge({
            userId: 'user-1',
            action: 'apiKey.create',
        });

        await expect(consumeChallenge(challenge.challengeId)).resolves.toMatchObject({ success: true });
        await expect(consumeChallenge(challenge.challengeId)).resolves.toMatchObject({
            success: false,
            reason: 'challenge_replayed',
        });
    });

    test('cleans expired memory challenges', async () => {
        const originalNow = Date.now;
        let now = originalNow();
        jest.spyOn(Date, 'now').mockImplementation(() => now);
        const challenge = await createChallenge({
            userId: 'user-1',
            action: 'webhook.secret.rotate',
            ttlSeconds: 1,
        });

        now += 1500;
        expect(await getChallenge(challenge.challengeId)).toBeNull();
        expect(cleanupExpiredChallenges()).toEqual({ removed: 0 });
        Date.now.mockRestore();
    });

    test('revokes all user challenges', async () => {
        await createChallenge({ userId: 'user-1', action: 'apiKey.create' });
        await createChallenge({ userId: 'user-1', action: 'apiKey.revoke' });
        await createChallenge({ userId: 'user-2', action: 'apiKey.create' });

        await expect(revokeUserChallenges('user-1')).resolves.toEqual({ revoked: 2 });
    });
});

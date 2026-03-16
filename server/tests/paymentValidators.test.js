const { completeChallengeSchema } = require('../validators/paymentValidators');

describe('Payment Validators', () => {
    test('completeChallengeSchema requires challengeToken', async () => {
        await expect(completeChallengeSchema.parseAsync({
            params: { intentId: 'pi_123456' },
            body: {},
        })).rejects.toBeTruthy();
    });

    test('completeChallengeSchema accepts valid payload', async () => {
        const parsed = await completeChallengeSchema.parseAsync({
            params: { intentId: 'pi_123456' },
            body: { challengeToken: 'abcdefghijklmnopqrstuvwxyz0123456789' },
        });

        expect(parsed.params.intentId).toBe('pi_123456');
        expect(parsed.body.challengeToken.length).toBeGreaterThan(20);
    });
});

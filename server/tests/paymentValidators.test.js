const { completeChallengeSchema, paymentMethodSchema } = require('../validators/paymentValidators');

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

    test('paymentMethodSchema blocks unexpected metadata keys and over-sized values', async () => {
        await expect(paymentMethodSchema.parseAsync({
            body: {
                providerMethodId: 'user@upi',
                metadata: { isAdmin: true },
            },
        })).rejects.toBeTruthy();

        await expect(paymentMethodSchema.parseAsync({
            body: {
                providerMethodId: 'user@upi',
                metadata: { reference: 'x'.repeat(81) },
            },
        })).rejects.toBeTruthy();
    });

    test('paymentMethodSchema accepts allowlisted metadata payload', async () => {
        const parsed = await paymentMethodSchema.parseAsync({
            body: {
                providerMethodId: 'user@upi',
                paymentIntentId: 'pi_123456',
                metadata: {
                    enrollmentSource: 'checkout',
                    nickname: 'My UPI',
                    reference: 'intent-link-1',
                },
            },
        });

        expect(parsed.body.metadata.enrollmentSource).toBe('checkout');
    });
});

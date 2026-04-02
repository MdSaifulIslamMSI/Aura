const { createIntentSchema, completeChallengeSchema, paymentMethodSchema } = require('../validators/paymentValidators');

describe('Payment Validators', () => {
    test('createIntentSchema accepts NETBANKING with explicit bank context', async () => {
        const parsed = await createIntentSchema.parseAsync({
            body: {
                quotePayload: {
                    orderItems: [{ product: 10, quantity: 1 }],
                },
                paymentMethod: 'NETBANKING',
                paymentContext: {
                    market: {
                        countryCode: 'in',
                        currency: 'inr',
                    },
                    netbanking: {
                        bankCode: 'hdfc',
                        bankName: 'HDFC Bank',
                        source: 'catalog',
                    },
                },
            },
        });

        expect(parsed.body.paymentMethod).toBe('NETBANKING');
        expect(parsed.body.paymentContext.market.countryCode).toBe('IN');
        expect(parsed.body.paymentContext.market.currency).toBe('INR');
        expect(parsed.body.paymentContext.netbanking.bankCode).toBe('HDFC');
    });

    test('createIntentSchema requires bank context for NETBANKING', async () => {
        await expect(createIntentSchema.parseAsync({
            body: {
                quotePayload: {
                    orderItems: [{ product: 10, quantity: 1 }],
                },
                paymentMethod: 'NETBANKING',
            },
        })).rejects.toBeTruthy();
    });

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

    test('createIntentSchema accepts ISO market context and blocks malformed codes', async () => {
        const parsed = await createIntentSchema.parseAsync({
            body: {
                quotePayload: {
                    orderItems: [{ product: 10, quantity: 1 }],
                },
                quoteSnapshot: {
                    totalPrice: 499,
                    cartVersion: 0,
                },
                paymentMethod: 'CARD',
                paymentContext: {
                    market: {
                        countryCode: 'us',
                        currency: 'usd',
                        language: 'es',
                    },
                },
            },
        });

        expect(parsed.body.paymentContext.market).toEqual({
            countryCode: 'US',
            currency: 'USD',
            language: 'es',
        });
        expect(parsed.body.quoteSnapshot).toEqual({
            totalPrice: 499,
            cartVersion: 0,
        });

        await expect(createIntentSchema.parseAsync({
            body: {
                quotePayload: {
                    orderItems: [{ product: 10, quantity: 1 }],
                },
                paymentMethod: 'CARD',
                paymentContext: {
                    market: {
                        countryCode: 'USA',
                        currency: 'usd',
                    },
                },
            },
        })).rejects.toBeTruthy();
    });
});

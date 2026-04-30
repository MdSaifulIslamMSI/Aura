const StripeProvider = require('../services/payments/providers/stripeProvider');

const mutateHex = (signature) => {
    if (!signature) return '0';
    const nextChar = signature.endsWith('a') ? 'b' : 'a';
    return `${signature.slice(0, -1)}${nextChar}`;
};

describe('StripeProvider', () => {
    const buildProvider = (stripeClient = {}) => new StripeProvider({
        secretKey: 'sk_test_secret',
        publishableKey: 'pk_test_publishable',
        webhookSecret: 'whsec_test',
        stripeClient: {
            paymentIntents: {
                create: jest.fn(),
                retrieve: jest.fn(),
                capture: jest.fn(),
                ...(stripeClient.paymentIntents || {}),
            },
            setupIntents: {
                create: jest.fn(),
                retrieve: jest.fn(),
                ...(stripeClient.setupIntents || {}),
            },
            refunds: {
                create: jest.fn(),
                ...(stripeClient.refunds || {}),
            },
            webhooks: {
                constructEvent: jest.fn(),
                ...(stripeClient.webhooks || {}),
            },
        },
    });

    test('creates manual-capture card PaymentIntents for checkout', async () => {
        const create = jest.fn().mockResolvedValue({
            id: 'pi_test_1',
            client_secret: 'pi_test_1_secret_123',
        });
        const provider = buildProvider({
            paymentIntents: { create },
        });

        const result = await provider.createOrder({
            amount: 12.34,
            currency: 'USD',
            receipt: 'intent_1',
            paymentMethod: 'CARD',
            notes: {
                order: 'checkout',
            },
        });

        expect(result).toMatchObject({ id: 'pi_test_1' });
        expect(create).toHaveBeenCalledWith({
            amount: 1234,
            currency: 'usd',
            capture_method: 'manual',
            payment_method_types: ['card'],
            metadata: {
                order: 'checkout',
                receipt: 'intent_1',
            },
        });
    });

    test('confirms saved Stripe card PaymentIntents during checkout', async () => {
        const create = jest.fn().mockResolvedValue({
            id: 'pi_saved_1',
            status: 'requires_capture',
            client_secret: 'pi_saved_1_secret_123',
        });
        const provider = buildProvider({
            paymentIntents: { create },
        });

        const result = await provider.createOrder({
            amount: 45,
            currency: 'USD',
            receipt: 'intent_saved_1',
            paymentMethod: 'CARD',
            savedMethod: {
                _id: 'method_1',
                provider: 'stripe',
                providerMethodId: 'pm_card_1',
                type: 'card',
            },
            notes: {
                order: 'checkout',
            },
        });

        expect(result).toMatchObject({ id: 'pi_saved_1', status: 'requires_capture' });
        expect(create).toHaveBeenCalledWith({
            amount: 4500,
            currency: 'usd',
            capture_method: 'manual',
            payment_method_types: ['card'],
            payment_method: 'pm_card_1',
            confirm: true,
            use_stripe_sdk: true,
            metadata: {
                order: 'checkout',
                receipt: 'intent_saved_1',
                savedPaymentMethodId: 'method_1',
            },
        });
    });

    test('includes saved card status in Stripe checkout payloads', () => {
        const provider = buildProvider();

        const payload = provider.buildCheckoutPayload({
            providerOrder: {
                id: 'pi_saved_1',
                status: 'requires_action',
                client_secret: 'pi_saved_1_secret_123',
            },
            amount: 45,
            currency: 'USD',
            savedMethod: {
                _id: 'method_1',
                provider: 'stripe',
                type: 'card',
                brand: 'visa',
                last4: '4242',
                isDefault: true,
            },
        });

        expect(payload).toMatchObject({
            provider: 'stripe',
            paymentIntentId: 'pi_saved_1',
            clientSecret: 'pi_saved_1_secret_123',
            status: 'requires_action',
            requiresAction: true,
            savedPaymentMethodId: 'method_1',
            savedPaymentMethod: {
                id: 'method_1',
                provider: 'stripe',
                type: 'card',
                brand: 'visa',
                last4: '4242',
                isDefault: true,
            },
        });
        expect(payload.confirmationSignature).toBeTruthy();
    });

    test('rejects non-card rails until the Stripe frontend supports them', async () => {
        const provider = buildProvider();
        await expect(provider.createOrder({
            amount: 10,
            currency: 'INR',
            receipt: 'intent_1',
            paymentMethod: 'UPI',
        })).rejects.toThrow('Stripe provider currently supports card checkout only');
    });

    test('creates and verifies card SetupIntents for manual method enrollment', async () => {
        const create = jest.fn().mockResolvedValue({
            id: 'seti_test_1',
            client_secret: 'seti_test_1_secret_123',
        });
        const retrieve = jest.fn().mockResolvedValue({
            id: 'seti_test_1',
            status: 'succeeded',
            metadata: { userId: 'user_1' },
            payment_method: {
                id: 'pm_card_1',
                card: {
                    brand: 'visa',
                    last4: '4242',
                },
            },
        });
        const provider = buildProvider({
            setupIntents: { create, retrieve },
        });

        const setupPayload = await provider.createSetupIntent({
            user: { _id: 'user_1', email: 'buyer@example.com' },
            metadata: { setupSource: 'profile' },
        });

        expect(setupPayload).toMatchObject({ id: 'seti_test_1' });
        expect(create).toHaveBeenCalledWith({
            usage: 'off_session',
            payment_method_types: ['card'],
            metadata: {
                setupSource: 'profile',
                userId: 'user_1',
                userEmail: 'buyer@example.com',
            },
        });

        const setupIntent = await provider.fetchSetupIntent('seti_test_1');
        expect(retrieve).toHaveBeenCalledWith('seti_test_1', {
            expand: ['payment_method'],
        });
        expect(provider.parseSetupPaymentMethod(setupIntent)).toEqual({
            type: 'card',
            brand: 'visa',
            last4: '4242',
            providerMethodId: 'pm_card_1',
        });
    });

    test('builds and verifies intent-bound confirmation signatures', () => {
        const provider = buildProvider();
        const signature = provider.getConfirmationSignature({
            orderId: 'pi_test_1',
            paymentId: 'pi_test_1',
        });

        expect(provider.verifySignature({
            orderId: 'pi_test_1',
            paymentId: 'pi_test_1',
            signature,
        })).toBe(true);
        expect(provider.verifySignature({
            orderId: 'pi_test_1',
            paymentId: 'pi_test_1',
            signature: mutateHex(signature),
        })).toBe(false);
    });

    test('verifies webhooks through the Stripe SDK and normalizes event payloads', () => {
        const constructEvent = jest.fn().mockReturnValue({ id: 'evt_1' });
        const provider = buildProvider({
            webhooks: { constructEvent },
        });
        const rawBody = JSON.stringify({
            id: 'evt_1',
            type: 'payment_intent.amount_capturable_updated',
            data: {
                object: {
                    id: 'pi_test_1',
                    object: 'payment_intent',
                    status: 'requires_capture',
                    amount: 1234,
                    currency: 'usd',
                },
            },
        });

        expect(provider.verifyWebhookSignature({ rawBody, signature: 'sig_test' })).toBe(true);
        expect(constructEvent).toHaveBeenCalledWith(rawBody, 'sig_test', 'whsec_test');
        expect(provider.parseWebhook(rawBody)).toMatchObject({
            id: 'evt_1',
            event: 'payment.authorized',
            payload: {
                payment: {
                    entity: {
                        id: 'pi_test_1',
                        order_id: 'pi_test_1',
                        status: 'authorized',
                    },
                },
            },
        });
    });

    test('normalizes fetched payments, captured amounts, and refunds', async () => {
        const retrieve = jest.fn().mockResolvedValue({
            id: 'pi_test_1',
            status: 'requires_capture',
            amount: 1234,
            currency: 'usd',
            payment_method: {
                id: 'pm_card_1',
                card: {
                    network: 'visa',
                    last4: '4242',
                },
            },
        });
        const capture = jest.fn().mockResolvedValue({
            id: 'pi_test_1',
            status: 'succeeded',
            amount: 1234,
            amount_received: 1234,
            currency: 'usd',
        });
        const refundCreate = jest.fn().mockResolvedValue({ id: 're_test_1' });
        const provider = buildProvider({
            paymentIntents: { retrieve, capture },
            refunds: { create: refundCreate },
        });

        const payment = await provider.fetchPayment('pi_test_1');
        expect(payment.status).toBe('authorized');
        expect(provider.parsePaymentMethod(payment)).toEqual({
            type: 'card',
            brand: 'visa',
            last4: '4242',
            providerMethodId: 'pm_card_1',
        });
        expect(provider.parsePaymentAmounts(payment)).toMatchObject({
            amount: 12.34,
            currency: 'USD',
        });

        await provider.capture({ paymentId: 'pi_test_1', amount: 12.34, currency: 'USD' });
        expect(capture).toHaveBeenCalledWith('pi_test_1', { amount_to_capture: 1234 });

        await provider.refund({
            paymentId: 'pi_test_1',
            amount: 5,
            currency: 'USD',
            notes: { reason: 'customer_request' },
        });
        expect(refundCreate).toHaveBeenCalledWith({
            payment_intent: 'pi_test_1',
            amount: 500,
            metadata: { reason: 'customer_request' },
        });
    });
});

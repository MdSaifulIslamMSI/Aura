describe('payment provider factory', () => {
    const originalEnv = { ...process.env };

    afterEach(() => {
        process.env = { ...originalEnv };
        jest.resetModules();
    });

    test('creates Stripe provider when explicitly requested and credentials exist', async () => {
        process.env.STRIPE_SECRET_KEY = 'sk_test_secret';
        process.env.STRIPE_PUBLISHABLE_KEY = 'pk_test_publishable';
        process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test';

        let factory;
        jest.isolateModules(() => {
            factory = require('../services/payments/providerFactory');
        });

        const provider = await factory.getPaymentProvider({ gatewayId: 'stripe' });
        expect(provider.name).toBe('stripe');
    });

    test('does not route to Stripe dynamically unless Stripe routing is enabled', async () => {
        process.env.PAYMENT_DYNAMIC_ROUTING_ENABLED = 'true';
        delete process.env.PAYMENT_STRIPE_ROUTING_ENABLED;

        let router;
        jest.isolateModules(() => {
            router = require('../services/payments/paymentRouter');
        });

        const route = await router.calculateOptimalRoute({
            amount: 100,
            currency: 'USD',
            paymentMethod: 'CARD',
            bin: '424242',
        });

        expect(route).toMatchObject({
            gatewayId: 'razorpay',
            routingStrategy: 'fallback_default',
            isOptimized: false,
        });
    });

    test('requires Stripe webhook secret when Stripe dynamic routing is enabled', () => {
        process.env.NODE_ENV = 'production';
        process.env.PAYMENTS_ENABLED = 'true';
        process.env.PAYMENT_PROVIDER = 'razorpay';
        process.env.PAYMENT_DYNAMIC_ROUTING_ENABLED = 'true';
        process.env.PAYMENT_STRIPE_ROUTING_ENABLED = 'true';
        process.env.PAYMENT_WEBHOOKS_ENABLED = 'true';
        process.env.RAZORPAY_KEY_ID = 'rzp_key';
        process.env.RAZORPAY_KEY_SECRET = 'rzp_secret';
        process.env.RAZORPAY_WEBHOOK_SECRET = 'rzp_whsec';
        process.env.STRIPE_SECRET_KEY = 'sk_test_secret';
        process.env.STRIPE_PUBLISHABLE_KEY = 'pk_test_publishable';
        delete process.env.STRIPE_WEBHOOK_SECRET;

        jest.isolateModules(() => {
            const { assertWebhookConfig, assertProductionPaymentConfig } = require('../config/paymentFlags');
            expect(() => assertWebhookConfig()).toThrow('Missing STRIPE_WEBHOOK_SECRET');
            expect(() => assertProductionPaymentConfig()).toThrow('Missing Stripe credentials');
        });
    });
});

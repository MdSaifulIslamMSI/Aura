describe('payment intent cart quote context', () => {
    const originalEnv = { ...process.env };

    afterEach(() => {
        process.env = { ...originalEnv };
        jest.resetModules();
        jest.clearAllMocks();
    });

    test('createPaymentIntent builds cart quotes with the authenticated user id', async () => {
        process.env = {
            ...originalEnv,
            PAYMENTS_ENABLED: 'true',
            PAYMENT_CHALLENGE_ENABLED: 'false',
            PAYMENT_SAVED_METHODS_ENABLED: 'false',
            PAYMENT_RISK_MODE: 'shadow',
            PAYMENT_PROVIDER: 'razorpay',
            RAZORPAY_KEY_ID: 'rzp_test_cart_quote',
        };

        const buildOrderQuote = jest.fn().mockResolvedValue({
            normalized: {
                checkoutSource: 'cart',
                shippingAddress: {
                    address: '221B Baker Street',
                    city: 'London',
                    postalCode: '10001',
                    country: 'India',
                },
                deliveryOption: 'standard',
                deliverySlot: 'anytime',
                couponCode: '',
                cartVersion: 4,
            },
            pricing: {
                totalPrice: 1999,
                baseAmount: 1999,
                baseCurrency: 'INR',
                displayAmount: 1999,
                displayCurrency: 'INR',
                settlementAmount: 1999,
                settlementCurrency: 'INR',
                fxRateLocked: 1,
                fxTimestamp: '2026-04-02T00:00:00.000Z',
                charge: null,
                market: {
                    countryCode: 'IN',
                    currency: 'INR',
                },
            },
        });
        const paymentIntentCreate = jest.fn().mockImplementation(async (doc) => doc);
        const paymentEventCreate = jest.fn().mockResolvedValue({});
        const providerCreateOrder = jest.fn().mockResolvedValue({ id: 'order_provider_1' });
        const getPaymentProvider = jest.fn().mockResolvedValue({
            name: 'razorpay',
            routingInsights: null,
            createOrder: providerCreateOrder,
        });
        const evaluateRisk = jest.fn().mockResolvedValue({
            blocked: false,
            challengeRequired: false,
            score: 0,
            strictDecision: 'allow',
            factors: [],
            mode: 'shadow',
        });

        jest.doMock('../services/orderPricingService', () => ({
            buildOrderQuote,
        }));
        jest.doMock('../models/PaymentIntent', () => ({
            countDocuments: jest.fn().mockResolvedValue(0),
            create: paymentIntentCreate,
        }));
        jest.doMock('../models/PaymentEvent', () => ({
            create: paymentEventCreate,
            findOne: jest.fn(),
        }));
        jest.doMock('../models/PaymentMethod', () => ({
            findOne: jest.fn(),
        }));
        jest.doMock('../services/payments/providerFactory', () => ({
            getPaymentProvider,
        }));
        jest.doMock('../services/payments/riskEngine', () => ({
            evaluateRisk,
        }));
        jest.doMock('../services/payments/paymentCapabilities', () => ({
            getPaymentCapabilities: jest.fn().mockResolvedValue({}),
        }));
        jest.doMock('../services/payments/paymentMarketCatalog', () => ({
            resolvePaymentMarketContext: jest.fn().mockReturnValue({
                market: {
                    countryCode: 'IN',
                    currency: 'INR',
                    settlementCurrency: 'INR',
                },
            }),
        }));

        let createPaymentIntent;
        jest.isolateModules(() => {
            ({ createPaymentIntent } = require('../services/payments/paymentService'));
        });

        const user = {
            _id: 'user_cart_1',
            name: 'Cart User',
            email: 'cart@example.com',
            phone: '+919999999999',
        };

        await createPaymentIntent({
            user,
            quotePayload: {
                checkoutSource: 'cart',
                cartVersion: 4,
                shippingAddress: {
                    address: '221B Baker Street',
                    city: 'London',
                    postalCode: '10001',
                    country: 'India',
                },
            },
            quoteSnapshot: {
                totalPrice: 1999,
                cartVersion: 4,
            },
            paymentMethod: 'CARD',
            requestMeta: {
                market: { countryCode: 'IN', currency: 'INR' },
            },
        });

        expect(buildOrderQuote).toHaveBeenCalledWith(
            expect.objectContaining({
                checkoutSource: 'cart',
                cartVersion: 4,
                paymentMethod: 'CARD',
            }),
            expect.objectContaining({
                checkStock: true,
                market: { countryCode: 'IN', currency: 'INR' },
                userId: 'user_cart_1',
            })
        );
        expect(providerCreateOrder).toHaveBeenCalled();
        expect(paymentIntentCreate).toHaveBeenCalledWith(expect.objectContaining({
            user: 'user_cart_1',
            metadata: expect.objectContaining({
                quoteSnapshot: expect.objectContaining({
                    totalPrice: 1999,
                    cartVersion: 4,
                }),
                checkoutSource: 'cart',
            }),
        }));
        expect(paymentEventCreate).toHaveBeenCalled();
        expect(getPaymentProvider).toHaveBeenCalled();
        expect(evaluateRisk).toHaveBeenCalled();
    });

    test('createPaymentIntent routes saved Stripe cards through the saved provider', async () => {
        process.env = {
            ...originalEnv,
            PAYMENTS_ENABLED: 'true',
            PAYMENT_CHALLENGE_ENABLED: 'false',
            PAYMENT_SAVED_METHODS_ENABLED: 'true',
            PAYMENT_RISK_MODE: 'shadow',
            PAYMENT_PROVIDER: 'razorpay',
            RAZORPAY_KEY_ID: 'rzp_test_cart_quote',
            STRIPE_SECRET_KEY: 'sk_test_secret',
            STRIPE_PUBLISHABLE_KEY: 'pk_test_publishable',
        };

        const savedMethod = {
            _id: 'method_1',
            user: 'user_cart_1',
            provider: 'stripe',
            providerMethodId: 'pm_card_1',
            type: 'card',
            brand: 'visa',
            last4: '4242',
            status: 'active',
        };
        const buildOrderQuote = jest.fn().mockResolvedValue({
            normalized: {
                checkoutSource: 'cart',
                shippingAddress: {
                    address: '221B Baker Street',
                    city: 'London',
                    postalCode: '10001',
                    country: 'India',
                },
                deliveryOption: 'standard',
                deliverySlot: 'anytime',
                couponCode: '',
                cartVersion: 4,
            },
            pricing: {
                totalPrice: 1999,
                baseAmount: 1999,
                baseCurrency: 'INR',
                displayAmount: 1999,
                displayCurrency: 'INR',
                settlementAmount: 1999,
                settlementCurrency: 'INR',
                fxRateLocked: 1,
                fxTimestamp: '2026-04-02T00:00:00.000Z',
                charge: null,
                market: {
                    countryCode: 'IN',
                    currency: 'INR',
                },
            },
        });
        const paymentIntentCreate = jest.fn().mockImplementation(async (doc) => doc);
        const paymentEventCreate = jest.fn().mockResolvedValue({});
        const providerCreateOrder = jest.fn().mockResolvedValue({
            id: 'pi_saved_1',
            status: 'requires_capture',
            client_secret: 'pi_saved_1_secret_123',
        });
        const providerBuildCheckoutPayload = jest.fn().mockReturnValue({
            provider: 'stripe',
            paymentIntentId: 'pi_saved_1',
            savedPaymentMethodId: 'method_1',
        });
        const getPaymentProvider = jest.fn().mockResolvedValue({
            name: 'stripe',
            routingInsights: null,
            createOrder: providerCreateOrder,
            buildCheckoutPayload: providerBuildCheckoutPayload,
        });
        const evaluateRisk = jest.fn().mockResolvedValue({
            blocked: false,
            challengeRequired: false,
            score: 0,
            strictDecision: 'allow',
            factors: [],
            mode: 'shadow',
        });
        const paymentMethodFindOne = jest.fn().mockReturnValue({
            lean: jest.fn().mockResolvedValue(savedMethod),
        });

        jest.doMock('../services/orderPricingService', () => ({
            buildOrderQuote,
        }));
        jest.doMock('../models/PaymentIntent', () => ({
            countDocuments: jest.fn().mockResolvedValue(0),
            create: paymentIntentCreate,
        }));
        jest.doMock('../models/PaymentEvent', () => ({
            create: paymentEventCreate,
            findOne: jest.fn(),
        }));
        jest.doMock('../models/PaymentMethod', () => ({
            findOne: paymentMethodFindOne,
        }));
        jest.doMock('../services/payments/providerFactory', () => ({
            getPaymentProvider,
        }));
        jest.doMock('../services/payments/riskEngine', () => ({
            evaluateRisk,
        }));
        jest.doMock('../services/payments/paymentCapabilities', () => ({
            getPaymentCapabilities: jest.fn().mockResolvedValue({}),
        }));
        jest.doMock('../services/payments/paymentMarketCatalog', () => ({
            resolvePaymentMarketContext: jest.fn().mockReturnValue({
                market: {
                    countryCode: 'IN',
                    currency: 'INR',
                    settlementCurrency: 'INR',
                },
            }),
        }));

        let createPaymentIntent;
        jest.isolateModules(() => {
            ({ createPaymentIntent } = require('../services/payments/paymentService'));
        });

        const user = {
            _id: 'user_cart_1',
            name: 'Cart User',
            email: 'cart@example.com',
            phone: '+919999999999',
        };

        const intent = await createPaymentIntent({
            user,
            quotePayload: {
                checkoutSource: 'cart',
                cartVersion: 4,
                shippingAddress: {
                    address: '221B Baker Street',
                    city: 'London',
                    postalCode: '10001',
                    country: 'India',
                },
            },
            quoteSnapshot: {
                totalPrice: 1999,
                cartVersion: 4,
            },
            paymentMethod: 'CARD',
            savedMethodId: 'method_1',
            requestMeta: {
                market: { countryCode: 'IN', currency: 'INR' },
            },
        });

        expect(paymentMethodFindOne).toHaveBeenCalledWith({
            _id: 'method_1',
            user: 'user_cart_1',
            status: 'active',
        });
        expect(getPaymentProvider).toHaveBeenCalledWith(expect.objectContaining({
            gatewayId: 'stripe',
            paymentMethod: 'CARD',
        }));
        expect(providerCreateOrder).toHaveBeenCalledWith(expect.objectContaining({
            paymentMethod: 'CARD',
            savedMethod,
            notes: expect.objectContaining({
                savedMethodId: 'method_1',
            }),
        }));
        expect(providerBuildCheckoutPayload).toHaveBeenCalledWith(expect.objectContaining({
            savedMethod,
        }));
        expect(intent.checkoutPayload).toMatchObject({
            provider: 'stripe',
            savedPaymentMethodId: 'method_1',
        });
    });

    test('createPaymentIntent returns Razorpay checkout config for saved wallet reuse', async () => {
        process.env = {
            ...originalEnv,
            PAYMENTS_ENABLED: 'true',
            PAYMENT_CHALLENGE_ENABLED: 'false',
            PAYMENT_SAVED_METHODS_ENABLED: 'true',
            PAYMENT_RISK_MODE: 'shadow',
            PAYMENT_PROVIDER: 'razorpay',
            RAZORPAY_KEY_ID: 'rzp_test_cart_quote',
        };

        const savedMethod = {
            _id: 'method_wallet_1',
            user: 'user_cart_1',
            provider: 'razorpay',
            providerMethodId: 'payzapp',
            type: 'wallet',
            brand: 'PayZapp',
            status: 'active',
        };
        const buildOrderQuote = jest.fn().mockResolvedValue({
            normalized: {
                checkoutSource: 'cart',
                shippingAddress: {
                    address: '221B Baker Street',
                    city: 'London',
                    postalCode: '10001',
                    country: 'India',
                },
                deliveryOption: 'standard',
                deliverySlot: 'anytime',
                couponCode: '',
                cartVersion: 4,
            },
            pricing: {
                totalPrice: 1999,
                baseAmount: 1999,
                baseCurrency: 'INR',
                displayAmount: 1999,
                displayCurrency: 'INR',
                settlementAmount: 1999,
                settlementCurrency: 'INR',
                fxRateLocked: 1,
                fxTimestamp: '2026-04-02T00:00:00.000Z',
                charge: null,
                market: {
                    countryCode: 'IN',
                    currency: 'INR',
                },
            },
        });
        const paymentIntentCreate = jest.fn().mockImplementation(async (doc) => doc);
        const paymentEventCreate = jest.fn().mockResolvedValue({});
        const providerCreateOrder = jest.fn().mockResolvedValue({ id: 'order_provider_1' });
        const getPaymentProvider = jest.fn().mockResolvedValue({
            name: 'razorpay',
            routingInsights: null,
            createOrder: providerCreateOrder,
        });
        const evaluateRisk = jest.fn().mockResolvedValue({
            blocked: false,
            challengeRequired: false,
            score: 0,
            strictDecision: 'allow',
            factors: [],
            mode: 'shadow',
        });
        const paymentMethodFindOne = jest.fn().mockReturnValue({
            lean: jest.fn().mockResolvedValue(savedMethod),
        });

        jest.doMock('../services/orderPricingService', () => ({
            buildOrderQuote,
        }));
        jest.doMock('../models/PaymentIntent', () => ({
            countDocuments: jest.fn().mockResolvedValue(0),
            create: paymentIntentCreate,
        }));
        jest.doMock('../models/PaymentEvent', () => ({
            create: paymentEventCreate,
            findOne: jest.fn(),
        }));
        jest.doMock('../models/PaymentMethod', () => ({
            findOne: paymentMethodFindOne,
        }));
        jest.doMock('../services/payments/providerFactory', () => ({
            getPaymentProvider,
        }));
        jest.doMock('../services/payments/riskEngine', () => ({
            evaluateRisk,
        }));
        jest.doMock('../services/payments/paymentCapabilities', () => ({
            getPaymentCapabilities: jest.fn().mockResolvedValue({}),
        }));
        jest.doMock('../services/payments/paymentMarketCatalog', () => ({
            resolvePaymentMarketContext: jest.fn().mockReturnValue({
                market: {
                    countryCode: 'IN',
                    currency: 'INR',
                    settlementCurrency: 'INR',
                },
            }),
        }));

        let createPaymentIntent;
        jest.isolateModules(() => {
            ({ createPaymentIntent } = require('../services/payments/paymentService'));
        });

        const intent = await createPaymentIntent({
            user: {
                _id: 'user_cart_1',
                name: 'Cart User',
                email: 'cart@example.com',
                phone: '+919999999999',
            },
            quotePayload: {
                checkoutSource: 'cart',
                cartVersion: 4,
                shippingAddress: {
                    address: '221B Baker Street',
                    city: 'London',
                    postalCode: '10001',
                    country: 'India',
                },
            },
            quoteSnapshot: {
                totalPrice: 1999,
                cartVersion: 4,
            },
            paymentMethod: 'WALLET',
            savedMethodId: 'method_wallet_1',
            requestMeta: {
                market: { countryCode: 'IN', currency: 'INR' },
            },
        });

        expect(getPaymentProvider).toHaveBeenCalledWith(expect.objectContaining({
            gatewayId: 'razorpay',
            paymentMethod: 'WALLET',
        }));
        expect(intent.checkoutPayload).toMatchObject({
            prefill: expect.objectContaining({ method: 'wallet' }),
            savedMethodReuse: {
                mode: 'saved_wallet_instrument',
                methodId: 'method_wallet_1',
                type: 'wallet',
                providerMethodId: 'payzapp',
            },
            config: {
                display: {
                    blocks: {
                        saved_method: {
                            instruments: [
                                {
                                    method: 'wallet',
                                    wallets: ['payzapp'],
                                },
                            ],
                        },
                    },
                    sequence: ['block.saved_method'],
                    preferences: {
                        show_default_blocks: false,
                    },
                },
            },
        });
    });
});

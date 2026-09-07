const User = require('../models/User');
const PaymentIntent = require('../models/PaymentIntent');
const PaymentEvent = require('../models/PaymentEvent');
const { PAYMENT_STATUSES } = require('../services/payments/constants');

const mockVerifyWebhookSignature = jest.fn();
const mockParseWebhook = jest.fn();

jest.mock('../services/payments/providerFactory', () => ({
    getPaymentProvider: jest.fn(async () => ({
        name: 'razorpay',
        verifyWebhookSignature: mockVerifyWebhookSignature,
        parseWebhook: mockParseWebhook,
    })),
}));

const logger = require('../utils/logger');
const { processRazorpayWebhook } = require('../services/payments/paymentService');
const bundleService = require('../services/bundleService');

const makeUser = async (overrides = {}) => User.create({
    name: 'Webhook Dup User',
    email: `webhook-dup-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`,
    phone: `+91${Math.floor(1000000000 + Math.random() * 9000000000)}`,
    isVerified: true,
    ...overrides,
});

const makeIntent = async ({ userId, status = PAYMENT_STATUSES.AUTHORIZED } = {}) => PaymentIntent.create({
    intentId: `pi_${Math.random().toString(36).slice(2, 10)}`,
    user: userId,
    provider: 'razorpay',
    providerOrderId: `order_${Math.random().toString(36).slice(2, 10)}`,
    amount: 1999,
    currency: 'INR',
    method: 'CARD',
    status,
    expiresAt: new Date(Date.now() + 30 * 60 * 1000),
    metadata: {},
    riskSnapshot: { score: 0, decision: 'allow', factors: [], mode: 'shadow' },
    challenge: { required: false, status: 'none', verifiedAt: null },
});

describe('webhook duplicate delivery resilience', () => {
    beforeEach(() => {
        jest.spyOn(logger, 'warn').mockImplementation(() => {});
        jest.spyOn(logger, 'error').mockImplementation(() => {});
        mockVerifyWebhookSignature.mockReset().mockReturnValue(true);
        mockParseWebhook.mockReset();
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    test('concurrent deliveries of the same event both resolve with exactly one processed', async () => {
        const user = await makeUser();
        const intent = await makeIntent({ userId: user._id });

        const eventPayload = {
            id: `evt_dup_race_${Date.now()}`,
            event: 'payment.captured',
            payload: {
                payment: {
                    entity: {
                        id: 'pay_dup_race_1',
                        order_id: intent.providerOrderId,
                        status: 'captured',
                        amount: 1999,
                    },
                },
            },
        };
        mockParseWebhook.mockReturnValue(eventPayload);
        const rawBody = JSON.stringify(eventPayload);

        const [first, second] = await Promise.allSettled([
            processRazorpayWebhook({ signature: 'sig', rawBody }),
            processRazorpayWebhook({ signature: 'sig', rawBody }),
        ]);

        // Before the fix, the losing insert surfaced an E11000 500 to the
        // provider, triggering pointless retries.
        expect(first.status).toBe('fulfilled');
        expect(second.status).toBe('fulfilled');

        const results = [first.value, second.value];
        expect(results.filter((result) => result.deduped === false)).toHaveLength(1);
        expect(results.filter((result) => result.deduped === true)).toHaveLength(1);

        const events = await PaymentEvent.find({ eventId: eventPayload.id }).lean();
        expect(events).toHaveLength(1);

        const refreshedIntent = await PaymentIntent.findById(intent._id).lean();
        expect(refreshedIntent.status).toBe(PAYMENT_STATUSES.CAPTURED);
    });
});

describe('bundleService regex safety', () => {
    afterEach(() => {
        jest.restoreAllMocks();
    });

    test('user-typed themes with regex metacharacters do not throw', async () => {
        for (const hostileTheme of ['winter [jacket', '*+? deals', 'back\\slash']) {
            await expect(bundleService.generateSmartBundle(hostileTheme, 5000)).resolves.toBeTruthy();
        }
    });
});

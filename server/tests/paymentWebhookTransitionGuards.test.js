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

const makeUser = async (overrides = {}) => User.create({
    name: 'Webhook User',
    email: `webhook-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`,
    phone: `+91${Math.floor(1000000000 + Math.random() * 9000000000)}`,
    isVerified: true,
    ...overrides,
});

const makeIntent = async ({ userId, status = PAYMENT_STATUSES.CREATED } = {}) => PaymentIntent.create({
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
    riskSnapshot: {
        score: 0,
        decision: 'allow',
        factors: [],
        mode: 'shadow',
    },
    challenge: {
        required: false,
        status: 'none',
        verifiedAt: null,
    },
});

describe('processRazorpayWebhook transition guards', () => {
    beforeEach(() => {
        jest.spyOn(logger, 'warn').mockImplementation(() => {});
        mockVerifyWebhookSignature.mockReset().mockReturnValue(true);
        mockParseWebhook.mockReset();
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    test('discards out-of-order backward transition and persists audit-only event', async () => {
        const user = await makeUser();
        const intent = await makeIntent({ userId: user._id, status: PAYMENT_STATUSES.CAPTURED });

        const eventPayload = {
            id: 'evt_back_authorized_1',
            event: 'payment.authorized',
            payload: {
                payment: {
                    entity: {
                        id: 'pay_1',
                        order_id: intent.providerOrderId,
                        status: 'authorized',
                        amount: 1999,
                    },
                },
            },
        };
        mockParseWebhook.mockReturnValue(eventPayload);

        const result = await processRazorpayWebhook({
            signature: 'sig',
            rawBody: JSON.stringify(eventPayload),
        });

        expect(result).toMatchObject({
            received: true,
            deduped: false,
            intentId: intent.intentId,
            discarded: true,
            reason: 'invalid_status_transition',
        });

        const refreshedIntent = await PaymentIntent.findById(intent._id).lean();
        expect(refreshedIntent.status).toBe(PAYMENT_STATUSES.CAPTURED);

        const savedEvent = await PaymentEvent.findOne({ eventId: 'evt_back_authorized_1' }).lean();
        expect(savedEvent).toBeTruthy();
        expect(savedEvent.payload.processingMeta).toMatchObject({
            discarded: true,
            reason: 'invalid_status_transition',
            currentStatus: PAYMENT_STATUSES.CAPTURED,
            targetStatus: PAYMENT_STATUSES.AUTHORIZED,
        });

        expect(logger.warn).toHaveBeenCalledWith(
            'payment.webhook_transition_discarded',
            expect.objectContaining({
                eventId: 'evt_back_authorized_1',
                currentStatus: PAYMENT_STATUSES.CAPTURED,
                targetStatus: PAYMENT_STATUSES.AUTHORIZED,
            })
        );
    });

    test('dedupes replayed event ids and does not append duplicate webhook events', async () => {
        const user = await makeUser();
        const intent = await makeIntent({ userId: user._id, status: PAYMENT_STATUSES.AUTHORIZED });

        const capturedEvent = {
            id: 'evt_captured_replay_1',
            event: 'payment.captured',
            payload: {
                payment: {
                    entity: {
                        id: 'pay_capture_1',
                        order_id: intent.providerOrderId,
                        status: 'captured',
                        amount: 1999,
                    },
                },
            },
        };
        mockParseWebhook.mockReturnValue(capturedEvent);

        const first = await processRazorpayWebhook({
            signature: 'sig',
            rawBody: JSON.stringify(capturedEvent),
        });
        expect(first).toMatchObject({ received: true, deduped: false, intentId: intent.intentId });

        const second = await processRazorpayWebhook({
            signature: 'sig',
            rawBody: JSON.stringify(capturedEvent),
        });
        expect(second).toMatchObject({ received: true, deduped: true });

        const events = await PaymentEvent.find({ eventId: 'evt_captured_replay_1' });
        expect(events).toHaveLength(1);
    });
});

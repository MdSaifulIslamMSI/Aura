const express = require('express');
const request = require('supertest');

const mockVerifyWebhookSignature = jest.fn();
const mockParseWebhook = jest.fn();
const mockParsePaymentAmounts = jest.fn();

jest.mock('../services/payments/providerFactory', () => ({
    getPaymentProvider: jest.fn(async () => ({
        name: 'razorpay',
        verifyWebhookSignature: mockVerifyWebhookSignature,
        parseWebhook: mockParseWebhook,
        parsePaymentAmounts: mockParsePaymentAmounts,
    })),
}));

const Order = require('../models/Order');
const PaymentEvent = require('../models/PaymentEvent');
const PaymentIntent = require('../models/PaymentIntent');
const paymentRoutes = require('../routes/paymentRoutes');
const { PAYMENT_STATUSES } = require('../services/payments/constants');
const {
    assertSafeStatus,
    createFakeOrder,
    createFakePaymentIntent,
    createFakeWebhookEvent,
    createTestUser,
    expectDocumentUnchanged,
} = require('./helpers/securityTestHelpers');

const buildApp = () => {
    const app = express();
    app.use(express.json({
        verify: (req, _res, buffer) => {
            req.rawBody = buffer.toString('utf8');
        },
    }));
    app.use('/api/payments', paymentRoutes);
    app.use((err, _req, res, _next) => {
        res.status(err.statusCode || err.status || 500).json({
            message: err.message || 'Internal Server Error',
        });
    });
    return app;
};

const seedAuthorizedIntentWithOrder = async ({
    amount = 1999,
    currency = 'INR',
    providerOrderId = 'order_security_webhook',
    providerPaymentId = '',
    intentId = 'pi_security_webhook',
} = {}) => {
    const user = await createTestUser({ name: 'Webhook Security User' });
    const order = await createFakeOrder({
        userId: user._id,
        totalPrice: amount,
        paymentIntentId: intentId,
        paymentState: PAYMENT_STATUSES.AUTHORIZED,
        isPaid: false,
        paymentMethod: 'CARD',
    });
    const intent = await createFakePaymentIntent({
        userId: user._id,
        order: order._id,
        intentId,
        providerOrderId,
        providerPaymentId,
        amount,
        currency,
        method: 'CARD',
        status: PAYMENT_STATUSES.AUTHORIZED,
    });
    return { user, order, intent };
};

const postRazorpayWebhook = (app, event, signature = 'valid-signature') => request(app)
    .post('/api/payments/webhooks/razorpay')
    .set('x-razorpay-signature', signature)
    .send(event);

describe('payment webhook security', () => {
    let app;

    beforeEach(() => {
        app = buildApp();
        mockVerifyWebhookSignature.mockReset().mockReturnValue(true);
        mockParseWebhook.mockReset().mockImplementation((rawBody) => JSON.parse(rawBody || '{}'));
        mockParsePaymentAmounts.mockReset().mockImplementation((payment = {}) => ({
            amount: Number(payment.amount || 0) / 100,
            amountMinor: Number(payment.amount || 0),
            currency: payment.currency || 'INR',
            amountRefunded: 0,
            amountRefundedMinor: 0,
            baseAmount: null,
            baseAmountMinor: null,
            baseCurrency: '',
            international: false,
        }));
    });

    test('missing webhook signature is rejected and does not mutate payment state', async () => {
        const { order, intent } = await seedAuthorizedIntentWithOrder({ providerOrderId: 'order_missing_sig' });
        const beforeOrder = await Order.findById(order._id).lean();
        const beforeIntent = await PaymentIntent.findById(intent._id).lean();
        const event = createFakeWebhookEvent({
            eventId: 'evt_missing_signature',
            providerOrderId: intent.providerOrderId,
            amount: intent.amount,
        });

        const response = await request(app)
            .post('/api/payments/webhooks/razorpay')
            .send(event);

        assertSafeStatus(response, [403]);
        await expectDocumentUnchanged(Order, order._id, beforeOrder);
        await expectDocumentUnchanged(PaymentIntent, intent._id, beforeIntent);
        await expect(PaymentEvent.countDocuments({ eventId: 'evt_missing_signature' })).resolves.toBe(0);
    });

    test('invalid webhook signature is rejected and does not mutate payment state', async () => {
        mockVerifyWebhookSignature.mockReturnValue(false);
        const { order, intent } = await seedAuthorizedIntentWithOrder({ providerOrderId: 'order_bad_sig' });
        const beforeOrder = await Order.findById(order._id).lean();
        const beforeIntent = await PaymentIntent.findById(intent._id).lean();
        const event = createFakeWebhookEvent({
            eventId: 'evt_invalid_signature',
            providerOrderId: intent.providerOrderId,
            amount: intent.amount,
        });

        const response = await postRazorpayWebhook(app, event, 'invalid-signature');

        assertSafeStatus(response, [400]);
        await expectDocumentUnchanged(Order, order._id, beforeOrder);
        await expectDocumentUnchanged(PaymentIntent, intent._id, beforeIntent);
        await expect(PaymentEvent.countDocuments({ eventId: 'evt_invalid_signature' })).resolves.toBe(0);
    });

    test('amount mismatch is rejected before capture mutation', async () => {
        const { order, intent } = await seedAuthorizedIntentWithOrder({
            providerOrderId: 'order_amount_mismatch',
            amount: 1999,
        });
        const beforeOrder = await Order.findById(order._id).lean();
        const beforeIntent = await PaymentIntent.findById(intent._id).lean();
        const event = createFakeWebhookEvent({
            eventId: 'evt_amount_mismatch',
            providerOrderId: intent.providerOrderId,
            amount: 1,
        });

        const response = await postRazorpayWebhook(app, event);

        assertSafeStatus(response, [409]);
        expect(response.body.message).toMatch(/amount mismatch/i);
        await expectDocumentUnchanged(Order, order._id, beforeOrder);
        await expectDocumentUnchanged(PaymentIntent, intent._id, beforeIntent);
        await expect(PaymentEvent.countDocuments({ eventId: 'evt_amount_mismatch' })).resolves.toBe(0);
    });

    test('currency mismatch is rejected before capture mutation', async () => {
        const { order, intent } = await seedAuthorizedIntentWithOrder({
            providerOrderId: 'order_currency_mismatch',
            amount: 1999,
            currency: 'INR',
        });
        const beforeOrder = await Order.findById(order._id).lean();
        const beforeIntent = await PaymentIntent.findById(intent._id).lean();
        const event = createFakeWebhookEvent({
            eventId: 'evt_currency_mismatch',
            providerOrderId: intent.providerOrderId,
            amount: intent.amount,
            currency: 'USD',
        });

        const response = await postRazorpayWebhook(app, event);

        assertSafeStatus(response, [409]);
        expect(response.body.message).toMatch(/currency mismatch/i);
        await expectDocumentUnchanged(Order, order._id, beforeOrder);
        await expectDocumentUnchanged(PaymentIntent, intent._id, beforeIntent);
        await expect(PaymentEvent.countDocuments({ eventId: 'evt_currency_mismatch' })).resolves.toBe(0);
    });

    test('payment id bound to a different provider order is rejected before mutation', async () => {
        const { order, intent } = await seedAuthorizedIntentWithOrder({
            providerOrderId: 'order_expected_binding',
            providerPaymentId: 'pay_bound_to_expected_order',
        });
        const beforeOrder = await Order.findById(order._id).lean();
        const beforeIntent = await PaymentIntent.findById(intent._id).lean();
        const event = createFakeWebhookEvent({
            eventId: 'evt_order_binding_mismatch',
            paymentId: 'pay_bound_to_expected_order',
            providerOrderId: 'order_attacker_binding',
            amount: intent.amount,
        });

        const response = await postRazorpayWebhook(app, event);

        assertSafeStatus(response, [409]);
        expect(response.body.message).toMatch(/order mismatch/i);
        await expectDocumentUnchanged(Order, order._id, beforeOrder);
        await expectDocumentUnchanged(PaymentIntent, intent._id, beforeIntent);
        await expect(PaymentEvent.countDocuments({ eventId: 'evt_order_binding_mismatch' })).resolves.toBe(0);
    });

    test('replayed webhook event id is deduped without a second mutation', async () => {
        const { order, intent } = await seedAuthorizedIntentWithOrder({
            providerOrderId: 'order_replay_guard',
            amount: 1999,
        });
        const event = createFakeWebhookEvent({
            eventId: 'evt_replay_guard',
            providerOrderId: intent.providerOrderId,
            amount: intent.amount,
        });

        const first = await postRazorpayWebhook(app, event);
        expect(first.statusCode).toBe(200);
        expect(first.body).toMatchObject({ received: true, deduped: false, intentId: intent.intentId });

        const afterFirstOrder = await Order.findById(order._id).lean();
        const afterFirstIntent = await PaymentIntent.findById(intent._id).lean();
        expect(afterFirstOrder.isPaid).toBe(true);
        expect(afterFirstOrder.paymentState).toBe(PAYMENT_STATUSES.CAPTURED);
        expect(afterFirstIntent.status).toBe(PAYMENT_STATUSES.CAPTURED);

        const second = await postRazorpayWebhook(app, event);
        expect(second.statusCode).toBe(200);
        expect(second.body).toMatchObject({ received: true, deduped: true });

        await expectDocumentUnchanged(Order, order._id, afterFirstOrder);
        await expectDocumentUnchanged(PaymentIntent, intent._id, afterFirstIntent);
        await expect(PaymentEvent.countDocuments({ eventId: 'evt_replay_guard' })).resolves.toBe(1);
    });
});

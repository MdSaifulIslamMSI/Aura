const mongoose = require('mongoose');
const User = require('../models/User');
const Order = require('../models/Order');
const PaymentIntent = require('../models/PaymentIntent');
const PaymentEvent = require('../models/PaymentEvent');
const { captureIntentNow } = require('../services/payments/paymentService');
const { PAYMENT_STATUSES } = require('../services/payments/constants');

const makeUser = async (overrides = {}) => User.create({
    name: 'Capture Race User',
    email: `capture-race-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`,
    phone: `+91${Math.floor(1000000000 + Math.random() * 9000000000)}`,
    isVerified: true,
    ...overrides,
});

const makeIntent = async ({
    userId,
    intentId = `pi_capture_${Math.random().toString(36).slice(2, 10)}`,
    amount = 1999,
    method = 'CARD',
    status = PAYMENT_STATUSES.AUTHORIZED,
    order = null,
} = {}) => PaymentIntent.create({
    intentId,
    user: userId,
    provider: 'razorpay',
    providerOrderId: `order_${Math.random().toString(36).slice(2, 10)}`,
    providerPaymentId: `pay_${Math.random().toString(36).slice(2, 10)}`,
    amount,
    currency: 'INR',
    settlementAmount: amount,
    settlementCurrency: 'INR',
    method,
    status,
    expiresAt: new Date(Date.now() + 30 * 60 * 1000),
    order,
    orderClaim: { state: 'none', key: '', lockedAt: null },
    riskSnapshot: { score: 0, decision: 'allow', factors: [], mode: 'shadow' },
    challenge: { required: false, status: 'none', verifiedAt: null },
    metadata: {},
});

const makeOrder = async ({ userId, totalPrice = 1999 } = {}) => Order.create({
    user: userId,
    orderItems: [{
        title: 'Capture Race Product',
        quantity: 1,
        image: 'https://example.com/product.jpg',
        price: totalPrice,
        product: new mongoose.Types.ObjectId(),
    }],
    shippingAddress: {
        address: '221B Baker Street',
        city: 'London',
        postalCode: '10001',
        country: 'India',
    },
    paymentMethod: 'CARD',
    itemsPrice: totalPrice,
    taxPrice: 0,
    shippingPrice: 0,
    totalPrice,
    settlementAmount: totalPrice,
    settlementCurrency: 'INR',
    presentmentTotalPrice: totalPrice,
    presentmentCurrency: 'INR',
    paymentState: PAYMENT_STATUSES.AUTHORIZED,
    isPaid: false,
    refundSummary: {
        totalRefunded: 0,
        settlementCurrency: 'INR',
        presentmentCurrency: 'INR',
        presentmentTotalRefunded: 0,
        fullyRefunded: false,
        refunds: [],
    },
});

const waitForProviderAttempt = async (capturePromise) => {
    for (let attempt = 0; attempt < 250; attempt += 1) {
        if (global.fetch.mock.calls.length > 0) return;
        const settled = await Promise.race([
            capturePromise.then(
                () => ({ status: 'fulfilled' }),
                (error) => ({ status: 'rejected', error })
            ),
            new Promise((resolve) => setTimeout(() => resolve(null), 10)),
        ]);
        if (settled?.status === 'rejected') throw settled.error;
        if (settled?.status === 'fulfilled') {
            throw new Error('Capture completed before provider attempt');
        }
    }
    throw new Error('Timed out waiting for capture provider attempt');
};

describe('Payment capture race safety', () => {
    const originalFetch = global.fetch;
    let releaseProvider;
    let providerGate;

    beforeEach(() => {
        process.env.RAZORPAY_KEY_ID = process.env.RAZORPAY_KEY_ID || 'rzp_test_key';
        process.env.RAZORPAY_KEY_SECRET = process.env.RAZORPAY_KEY_SECRET || 'rzp_test_secret';
    });

    afterEach(() => {
        global.fetch = originalFetch;
    });

    test('concurrent captures mutate the provider exactly once and the loser gets a 409', async () => {
        const owner = await makeUser();
        const order = await makeOrder({ userId: owner._id });
        const intent = await makeIntent({ userId: owner._id, order: order._id });
        await Order.updateOne({ _id: order._id }, { $set: { paymentIntentId: intent.intentId } });

        providerGate = new Promise((resolve) => {
            releaseProvider = resolve;
        });
        global.fetch = jest.fn().mockImplementation(async () => {
            await providerGate;
            return {
                ok: true,
                json: async () => ({
                    id: intent.providerPaymentId,
                    amount: intent.amount * 100,
                    currency: 'INR',
                    status: 'captured',
                }),
            };
        });

        try {
            const firstCapture = captureIntentNow({ intentId: intent.intentId });
            await waitForProviderAttempt(firstCapture);

            await expect(captureIntentNow({ intentId: intent.intentId })).rejects.toMatchObject({
                statusCode: 409,
                message: expect.stringMatching(/capture.*already in progress/i),
            });

            releaseProvider();
            const captured = await firstCapture;

            expect(captured.status).toBe(PAYMENT_STATUSES.CAPTURED);
            expect(global.fetch).toHaveBeenCalledTimes(1);

            const refreshedIntent = await PaymentIntent.findOne({ intentId: intent.intentId }).lean();
            expect(refreshedIntent.status).toBe(PAYMENT_STATUSES.CAPTURED);
            expect(refreshedIntent.metadata?.captureLock).toBeUndefined();

            const refreshedOrder = await Order.findById(order._id).lean();
            expect(refreshedOrder.isPaid).toBe(true);
            expect(refreshedOrder.paymentState).toBe(PAYMENT_STATUSES.CAPTURED);

            const captureEvents = await PaymentEvent.find({
                intentId: intent.intentId,
                type: 'intent.captured',
            }).lean();
            expect(captureEvents).toHaveLength(1);
        } finally {
            releaseProvider();
        }
    });

    test('capture after a completed capture is idempotent and never re-calls the provider', async () => {
        const owner = await makeUser();
        const order = await makeOrder({ userId: owner._id });
        const intent = await makeIntent({ userId: owner._id, order: order._id });
        intent.status = PAYMENT_STATUSES.CAPTURED;
        intent.capturedAt = new Date();
        await intent.save();

        global.fetch = jest.fn();

        const result = await captureIntentNow({ intentId: intent.intentId });

        expect(result.status).toBe(PAYMENT_STATUSES.CAPTURED);
        expect(global.fetch).not.toHaveBeenCalled();

        const refreshedIntent = await PaymentIntent.findOne({ intentId: intent.intentId }).lean();
        expect(refreshedIntent.metadata?.captureLock).toBeUndefined();
    });

    test('capture lock is released when the provider call fails so a retry can proceed', async () => {
        const owner = await makeUser();
        const order = await makeOrder({ userId: owner._id });
        const intent = await makeIntent({ userId: owner._id, order: order._id });
        await Order.updateOne({ _id: order._id }, { $set: { paymentIntentId: intent.intentId } });

        global.fetch = jest.fn()
            .mockResolvedValueOnce({
                ok: false,
                status: 500,
                json: async () => ({ error: { description: 'provider temporarily unavailable' } }),
            })
            .mockResolvedValueOnce({
                ok: true,
                json: async () => ({
                    id: intent.providerPaymentId,
                    amount: intent.amount * 100,
                    currency: 'INR',
                    status: 'captured',
                }),
            });

        await expect(captureIntentNow({ intentId: intent.intentId })).rejects.toBeTruthy();

        const failedIntent = await PaymentIntent.findOne({ intentId: intent.intentId }).lean();
        expect(failedIntent.metadata?.captureLock).toBeUndefined();

        const captured = await captureIntentNow({ intentId: intent.intentId });
        expect(captured.status).toBe(PAYMENT_STATUSES.CAPTURED);

        const refreshedOrder = await Order.findById(order._id).lean();
        expect(refreshedOrder.isPaid).toBe(true);
    });
});

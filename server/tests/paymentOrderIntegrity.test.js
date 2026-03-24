const mongoose = require('mongoose');
const AppError = require('../utils/AppError');
const User = require('../models/User');
const Order = require('../models/Order');
const PaymentIntent = require('../models/PaymentIntent');
const PaymentEvent = require('../models/PaymentEvent');
const PaymentOutboxTask = require('../models/PaymentOutboxTask');
const {
    validatePaymentIntentForOrder,
    scheduleCaptureTask,
    linkIntentToOrder,
    createRefundForIntent,
} = require('../services/payments/paymentService');
const { PAYMENT_STATUSES } = require('../services/payments/constants');

const makeUser = async (overrides = {}) => User.create({
    name: 'Test User',
    email: `user-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`,
    phone: `+91${Math.floor(1000000000 + Math.random() * 9000000000)}`,
    isVerified: true,
    ...overrides,
});

const makeIntent = async ({
    userId,
    intentId = `pi_${Math.random().toString(36).slice(2, 10)}`,
    amount = 1999,
    method = 'UPI',
    status = PAYMENT_STATUSES.AUTHORIZED,
    expiresAt = new Date(Date.now() + 30 * 60 * 1000),
    order = null,
    orderClaim = { state: 'none', key: '', lockedAt: null },
} = {}) => PaymentIntent.create({
    intentId,
    user: userId,
    provider: 'simulated',
    providerOrderId: `sim_order_${Math.random().toString(36).slice(2, 10)}`,
    amount,
    currency: 'INR',
    method,
    status,
    expiresAt,
    order,
    orderClaim,
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
    metadata: {},
});

const makeOrder = async ({
    userId,
    productId = new mongoose.Types.ObjectId(),
    totalPrice = 1999,
    paymentIntentId = '',
    paymentState = PAYMENT_STATUSES.CAPTURED,
    refundSummary = {
        totalRefunded: 0,
        fullyRefunded: false,
        refunds: [],
    },
} = {}) => Order.create({
    user: userId,
    orderItems: [{
        title: 'Test Product',
        quantity: 1,
        image: 'https://example.com/product.jpg',
        price: totalPrice,
        product: productId,
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
    paymentIntentId,
    paymentState,
    isPaid: true,
    paidAt: new Date(),
    refundSummary,
});

describe('Payment Order Integrity', () => {
    test('digital checkout requires a successful simulation when no intent exists in simulated mode', async () => {
        await expect(validatePaymentIntentForOrder({
            userId: new mongoose.Types.ObjectId(),
            paymentIntentId: '',
            paymentMethod: 'UPI',
            totalPrice: 499,
            paymentSimulation: { status: 'failure' },
        })).rejects.toMatchObject({
            statusCode: 400,
            message: expect.stringMatching(/simulation/i),
        });

        await expect(validatePaymentIntentForOrder({
            userId: new mongoose.Types.ObjectId(),
            paymentIntentId: '',
            paymentMethod: 'UPI',
            totalPrice: 499,
            paymentSimulation: { status: 'success' },
        })).resolves.toMatchObject({
            paymentIntent: null,
            isPaid: true,
            paymentState: PAYMENT_STATUSES.CAPTURED,
        });
    });

    test('validatePaymentIntentForOrder treats NETBANKING as a first-class digital rail', async () => {
        await expect(validatePaymentIntentForOrder({
            userId: new mongoose.Types.ObjectId(),
            paymentIntentId: '',
            paymentMethod: 'NETBANKING',
            totalPrice: 899,
            paymentSimulation: { status: 'success' },
        })).resolves.toMatchObject({
            paymentIntent: null,
            isPaid: true,
            paymentState: PAYMENT_STATUSES.CAPTURED,
        });

        const user = await makeUser();
        const intent = await makeIntent({
            userId: user._id,
            amount: 1899,
            method: 'NETBANKING',
            status: PAYMENT_STATUSES.AUTHORIZED,
        });

        await expect(validatePaymentIntentForOrder({
            userId: user._id,
            paymentIntentId: intent.intentId,
            paymentMethod: 'NETBANKING',
            totalPrice: 1899,
        })).resolves.toMatchObject({
            paymentIntent: expect.objectContaining({ intentId: intent.intentId, method: 'NETBANKING' }),
            isPaid: false,
            paymentState: PAYMENT_STATUSES.AUTHORIZED,
        });
    });

    test('validatePaymentIntentForOrder rejects foreign-user, expired, amount mismatch, method mismatch, and unauthorized intents', async () => {
        const owner = await makeUser();
        const attacker = await makeUser();

        const goodIntent = await makeIntent({ userId: owner._id, amount: 2499, method: 'CARD' });
        await expect(validatePaymentIntentForOrder({
            userId: attacker._id,
            paymentIntentId: goodIntent.intentId,
            paymentMethod: 'CARD',
            totalPrice: 2499,
        })).rejects.toMatchObject({
            statusCode: 404,
            message: expect.stringMatching(/not found/i),
        });

        const expiredIntent = await makeIntent({
            userId: owner._id,
            amount: 2499,
            method: 'CARD',
            expiresAt: new Date(Date.now() - 60 * 1000),
        });
        await expect(validatePaymentIntentForOrder({
            userId: owner._id,
            paymentIntentId: expiredIntent.intentId,
            paymentMethod: 'CARD',
            totalPrice: 2499,
        })).rejects.toMatchObject({
            statusCode: 409,
            message: expect.stringMatching(/expired/i),
        });

        await expect(validatePaymentIntentForOrder({
            userId: owner._id,
            paymentIntentId: goodIntent.intentId,
            paymentMethod: 'CARD',
            totalPrice: 2599,
        })).rejects.toMatchObject({
            statusCode: 409,
            message: expect.stringMatching(/amount mismatch/i),
        });

        await expect(validatePaymentIntentForOrder({
            userId: owner._id,
            paymentIntentId: goodIntent.intentId,
            paymentMethod: 'UPI',
            totalPrice: 2499,
        })).rejects.toMatchObject({
            statusCode: 409,
            message: expect.stringMatching(/method mismatch/i),
        });

        const pendingIntent = await makeIntent({
            userId: owner._id,
            amount: 2499,
            method: 'CARD',
            status: PAYMENT_STATUSES.CREATED,
        });
        await expect(validatePaymentIntentForOrder({
            userId: owner._id,
            paymentIntentId: pendingIntent.intentId,
            paymentMethod: 'CARD',
            totalPrice: 2499,
        })).rejects.toMatchObject({
            statusCode: 400,
            message: expect.stringMatching(/not authorized/i),
        });
    });

    test('claimForOrder locks an authorized intent exactly once per claim key and linkIntentToOrder consumes the lock', async () => {
        const user = await makeUser();
        const intent = await makeIntent({
            userId: user._id,
            amount: 1399,
            method: 'UPI',
            status: PAYMENT_STATUSES.AUTHORIZED,
        });

        const firstClaim = await validatePaymentIntentForOrder({
            userId: user._id,
            paymentIntentId: intent.intentId,
            paymentMethod: 'UPI',
            totalPrice: 1399,
            claimForOrder: true,
            claimKey: 'claim-alpha',
        });

        expect(firstClaim.claimKey).toBe('claim-alpha');
        expect(firstClaim.paymentIntent.orderClaim.state).toBe('locked');
        expect(firstClaim.paymentIntent.orderClaim.key).toBe('claim-alpha');

        const idempotentClaim = await validatePaymentIntentForOrder({
            userId: user._id,
            paymentIntentId: intent.intentId,
            paymentMethod: 'UPI',
            totalPrice: 1399,
            claimForOrder: true,
            claimKey: 'claim-alpha',
        });

        expect(idempotentClaim.paymentIntent.orderClaim.key).toBe('claim-alpha');

        await expect(validatePaymentIntentForOrder({
            userId: user._id,
            paymentIntentId: intent.intentId,
            paymentMethod: 'UPI',
            totalPrice: 1399,
            claimForOrder: true,
            claimKey: 'claim-beta',
        })).rejects.toMatchObject({
            statusCode: 409,
            message: expect.stringMatching(/already being used/i),
        });

        const orderId = new mongoose.Types.ObjectId();
        const linked = await linkIntentToOrder({
            intentId: intent.intentId,
            orderId,
            claimKey: 'claim-alpha',
        });

        expect(String(linked.order)).toBe(String(orderId));
        expect(linked.orderClaim.state).toBe('consumed');
        expect(linked.orderClaim.key).toBe('claim-alpha');
    });

    test('scheduleCaptureTask creates one durable pending capture task for authorized intents and is idempotent', async () => {
        const user = await makeUser();
        const intent = await makeIntent({
            userId: user._id,
            amount: 3299,
            method: 'CARD',
            status: PAYMENT_STATUSES.AUTHORIZED,
        });

        const firstTask = await scheduleCaptureTask({ intentId: intent.intentId });
        expect(firstTask).toBeTruthy();
        expect(firstTask.taskType).toBe('capture');
        expect(firstTask.status).toBe('pending');

        const secondTask = await scheduleCaptureTask({ intentId: intent.intentId });
        expect(String(secondTask._id)).toBe(String(firstTask._id));

        const persistedTasks = await PaymentOutboxTask.find({
            taskType: 'capture',
            intentId: intent.intentId,
        });
        expect(persistedTasks).toHaveLength(1);
        expect(persistedTasks[0].status).toBe('pending');
    });

    test('scheduleCaptureTask rejects missing and non-authorized intents and skips already-captured intents', async () => {
        await expect(scheduleCaptureTask({ intentId: 'pi_missing' })).rejects.toMatchObject({
            statusCode: 404,
            message: expect.stringMatching(/not found/i),
        });

        const user = await makeUser();
        const createdIntent = await makeIntent({
            userId: user._id,
            status: PAYMENT_STATUSES.CREATED,
        });
        await expect(scheduleCaptureTask({ intentId: createdIntent.intentId })).rejects.toMatchObject({
            statusCode: 409,
            message: expect.stringMatching(/authorized state/i),
        });

        const capturedIntent = await makeIntent({
            userId: user._id,
            status: PAYMENT_STATUSES.CAPTURED,
        });
        await expect(scheduleCaptureTask({ intentId: capturedIntent.intentId })).resolves.toBeNull();
    });

    test('createRefundForIntent rejects unauthorized refunds and persists partial then full refund state', async () => {
        const owner = await makeUser();
        const outsider = await makeUser();
        const order = await makeOrder({
            userId: owner._id,
            totalPrice: 3000,
        });
        const intent = await makeIntent({
            userId: owner._id,
            amount: 3000,
            method: 'CARD',
            status: PAYMENT_STATUSES.CAPTURED,
            order: order._id,
        });
        intent.providerPaymentId = 'pay_simulated_123';
        await intent.save();

        await Order.updateOne(
            { _id: order._id },
            { $set: { paymentIntentId: intent.intentId } }
        );

        await expect(createRefundForIntent({
            actorUserId: outsider._id,
            isAdmin: false,
            intentId: intent.intentId,
            amount: 500,
            reason: 'unauthorized_attempt',
        })).rejects.toMatchObject({
            statusCode: 403,
            message: expect.stringMatching(/not authorized/i),
        });

        const firstRefund = await createRefundForIntent({
            actorUserId: owner._id,
            isAdmin: false,
            intentId: intent.intentId,
            amount: 1000,
            reason: 'customer_partial_refund',
        });

        expect(firstRefund.amount).toBe(1000);

        const afterPartialOrder = await Order.findById(order._id).lean();
        const afterPartialIntent = await PaymentIntent.findOne({ intentId: intent.intentId }).lean();
        expect(afterPartialOrder.refundSummary.totalRefunded).toBe(1000);
        expect(afterPartialOrder.refundSummary.fullyRefunded).toBe(false);
        expect(afterPartialOrder.paymentState).toBe(PAYMENT_STATUSES.PARTIALLY_REFUNDED);
        expect(afterPartialIntent.status).toBe(PAYMENT_STATUSES.PARTIALLY_REFUNDED);

        const secondRefund = await createRefundForIntent({
            actorUserId: owner._id,
            isAdmin: false,
            intentId: intent.intentId,
            amount: 2000,
            reason: 'customer_full_refund',
        });

        expect(secondRefund.amount).toBe(2000);

        const afterFullOrder = await Order.findById(order._id).lean();
        const afterFullIntent = await PaymentIntent.findOne({ intentId: intent.intentId }).lean();
        const refundEvents = await PaymentEvent.find({
            intentId: intent.intentId,
            type: 'refund.created',
        }).lean();

        expect(afterFullOrder.refundSummary.totalRefunded).toBe(3000);
        expect(afterFullOrder.refundSummary.fullyRefunded).toBe(true);
        expect(afterFullOrder.paymentState).toBe(PAYMENT_STATUSES.REFUNDED);
        expect(afterFullIntent.status).toBe(PAYMENT_STATUSES.REFUNDED);
        expect(afterFullOrder.refundSummary.refunds).toHaveLength(2);
        expect(refundEvents).toHaveLength(2);
    });
});

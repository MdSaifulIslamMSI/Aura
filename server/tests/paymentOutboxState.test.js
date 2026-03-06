const mongoose = require('mongoose');
const Order = require('../models/Order');
const User = require('../models/User');
const PaymentIntent = require('../models/PaymentIntent');
const PaymentOutboxTask = require('../models/PaymentOutboxTask');
const { PAYMENT_STATUSES } = require('../services/payments/constants');
const {
    scheduleRefundTask,
    updateOrderCommandRefundEntry,
    getPaymentOutboxStats,
} = require('../services/payments/outboxState');

const makeUser = async (overrides = {}) => User.create({
    name: 'Outbox User',
    email: `outbox-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`,
    phone: `+91${Math.floor(1000000000 + Math.random() * 9000000000)}`,
    isVerified: true,
    ...overrides,
});

const makeIntent = async ({ userId, intentId = `pi_${Math.random().toString(36).slice(2, 10)}` } = {}) => PaymentIntent.create({
    intentId,
    user: userId,
    provider: 'simulated',
    providerOrderId: `sim_order_${Math.random().toString(36).slice(2, 10)}`,
    amount: 1999,
    currency: 'INR',
    method: 'CARD',
    status: PAYMENT_STATUSES.AUTHORIZED,
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

const makeOrder = async ({ userId } = {}) => Order.create({
    user: userId,
    orderItems: [{
        title: 'Outbox Product',
        quantity: 1,
        image: 'https://example.com/product.jpg',
        price: 1999,
        product: new mongoose.Types.ObjectId(),
    }],
    shippingAddress: {
        address: '221B Baker Street',
        city: 'London',
        postalCode: '10001',
        country: 'India',
    },
    paymentMethod: 'CARD',
    itemsPrice: 1999,
    taxPrice: 0,
    shippingPrice: 0,
    totalPrice: 1999,
    paymentState: PAYMENT_STATUSES.AUTHORIZED,
    commandCenter: {
        refunds: [{
            requestId: 'refund_req_1',
            status: 'pending',
            amount: 499,
            reason: 'damage',
            message: '',
            refundId: '',
            createdAt: new Date('2026-03-06T00:00:00.000Z'),
            updatedAt: null,
            processedAt: null,
        }],
        lastUpdatedAt: new Date('2026-03-06T00:00:00.000Z'),
    },
});

describe('Payment outbox state helpers', () => {
    test('scheduleRefundTask is idempotent per requestId and intentId', async () => {
        const user = await makeUser();
        const intent = await makeIntent({ userId: user._id });
        const order = await makeOrder({ userId: user._id });

        const firstTask = await scheduleRefundTask({
            intentId: intent.intentId,
            amount: 499,
            reason: 'damage',
            orderId: order._id,
            requestId: 'refund_req_1',
            actorUserId: user._id,
        });

        const secondTask = await scheduleRefundTask({
            intentId: intent.intentId,
            amount: 499,
            reason: 'damage',
            orderId: order._id,
            requestId: 'refund_req_1',
            actorUserId: user._id,
        });

        expect(String(secondTask._id)).toBe(String(firstTask._id));

        const persistedTasks = await PaymentOutboxTask.find({
            taskType: 'refund',
            intentId: intent.intentId,
        });
        expect(persistedTasks).toHaveLength(1);
        expect(persistedTasks[0].payload.requestId).toBe('refund_req_1');
    });

    test('updateOrderCommandRefundEntry updates command center refund status and metadata', async () => {
        const user = await makeUser();
        const order = await makeOrder({ userId: user._id });
        const processedAt = new Date('2026-03-06T01:00:00.000Z');

        await updateOrderCommandRefundEntry({
            orderId: order._id,
            requestId: 'refund_req_1',
            status: 'processed',
            message: 'Refund completed',
            refundId: 'rfnd_123',
            processedAt,
        });

        const refreshed = await Order.findById(order._id).lean();
        expect(refreshed.commandCenter.refunds[0]).toMatchObject({
            requestId: 'refund_req_1',
            status: 'processed',
            message: 'Refund completed',
            refundId: 'rfnd_123',
        });
        expect(new Date(refreshed.commandCenter.refunds[0].processedAt).toISOString()).toBe(processedAt.toISOString());
    });

    test('getPaymentOutboxStats summarizes pending processing and failed tasks by type', async () => {
        const user = await makeUser();
        const intent = await makeIntent({ userId: user._id });
        const order = await makeOrder({ userId: user._id });

        await PaymentOutboxTask.create([
            {
                taskType: 'capture',
                intentId: intent.intentId,
                payload: {},
                status: 'pending',
                retryCount: 0,
                nextRunAt: new Date(),
            },
            {
                taskType: 'refund',
                intentId: `${intent.intentId}_refund`,
                payload: { orderId: String(order._id), requestId: 'refund_req_2' },
                status: 'failed',
                retryCount: 2,
                nextRunAt: new Date(),
            },
        ]);

        const stats = await getPaymentOutboxStats();
        expect(stats).toMatchObject({
            status: 'ok',
            pending: expect.any(Number),
            processing: expect.any(Number),
            failed: expect.any(Number),
        });
        expect(stats.taskTypes.capture.pending).toBeGreaterThanOrEqual(1);
        expect(stats.taskTypes.refund.failed).toBeGreaterThanOrEqual(1);
    });
});

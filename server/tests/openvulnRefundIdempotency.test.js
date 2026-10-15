/**
 * Regression coverage for the OpenVuln refund-idempotency findings.
 *
 * These pin the provider-side seams of createRefundForIntent. Before the fix
 * none of them was asserted anywhere, so deleting the reconciliation, the
 * request-scoped key or the replay guard left the whole suite green.
 *
 * The provider is mocked at the factory boundary so the assertions are about the
 * service's contract with a provider, not about Razorpay's HTTP shape.
 */

const mongoose = require('mongoose');

const mockProvider = {
    refund: jest.fn(),
    fetchRefunds: jest.fn(),
};

jest.mock('../services/payments/providerFactory', () => ({
    getPaymentProvider: jest.fn(async () => mockProvider),
    getInternalProvider: jest.fn(async () => mockProvider),
}));

const User = require('../models/User');
const Order = require('../models/Order');
const PaymentIntent = require('../models/PaymentIntent');
const { createRefundForIntent } = require('../services/payments/paymentService');
const { PAYMENT_STATUSES } = require('../services/payments/constants');

const makeUser = async () => User.create({
    name: 'Refund User',
    email: `refund-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`,
    phone: `+91${Math.floor(1000000000 + Math.random() * 9000000000)}`,
    isVerified: true,
});

const seedRefundableIntent = async (user, { orderStatus = 'placed' } = {}) => {
    const order = await Order.create({
        user: user._id,
        orderItems: [{
            title: 'Test Product',
            quantity: 1,
            image: 'https://example.com/product.jpg',
            price: 3000,
            product: new mongoose.Types.ObjectId(),
        }],
        shippingAddress: {
            address: '221B Baker Street',
            city: 'London',
            postalCode: '10001',
            country: 'India',
        },
        paymentMethod: 'UPI',
        orderStatus,
        totalPrice: 3000,
        itemsPrice: 3000,
        shippingPrice: 0,
        settlementAmount: 3000,
        settlementCurrency: 'INR',
        presentmentTotalPrice: 3000,
        presentmentCurrency: 'INR',
        isPaid: true,
        paidAt: new Date(),
        paymentState: PAYMENT_STATUSES.CAPTURED,
        refundSummary: {
            totalRefunded: 0,
            settlementCurrency: 'INR',
            presentmentCurrency: 'INR',
            presentmentTotalRefunded: 0,
            fullyRefunded: false,
            refunds: [],
        },
        commandCenter: { refunds: [] },
    });

    const intent = await PaymentIntent.create({
        intentId: `pi_${Math.random().toString(36).slice(2, 10)}`,
        user: user._id,
        provider: 'razorpay',
        providerOrderId: `order_${Math.random().toString(36).slice(2, 10)}`,
        providerPaymentId: `pay_${Math.random().toString(36).slice(2, 10)}`,
        amount: 3000,
        settlementAmount: 3000,
        currency: 'INR',
        settlementCurrency: 'INR',
        method: 'UPI',
        status: PAYMENT_STATUSES.CAPTURED,
        expiresAt: new Date(Date.now() + 30 * 60 * 1000),
        order: order._id,
        orderClaim: { state: 'none', key: '', lockedAt: null },
        riskSnapshot: { score: 0, decision: 'allow', factors: [], mode: 'shadow' },
        challenge: { required: false, status: 'none', verifiedAt: null },
        metadata: {},
    });

    await Order.updateOne({ _id: order._id }, { $set: { paymentIntentId: intent.intentId } });
    return { order, intent };
};

describe('OpenVuln refund provider-idempotency regressions', () => {
    beforeEach(() => {
        mockProvider.refund.mockReset();
        mockProvider.fetchRefunds.mockReset();
        mockProvider.fetchRefunds.mockResolvedValue({ items: [] });
    });

    afterAll(async () => {
        await mongoose.connection.close();
    });

    // BUG-R2-C1-A4-H1
    test('reconciles provider state before executing an irreversible refund', async () => {
        const user = await makeUser();
        const { intent } = await seedRefundableIntent(user);
        mockProvider.refund.mockResolvedValue({ id: 'rfnd_new', status: 'processed' });

        await createRefundForIntent({
            actorUserId: user._id,
            isAdmin: false,
            intentId: intent.intentId,
            amount: 1000,
            reason: 'customer_request',
            requestId: 'rfnd_req_reconcile_1',
        });

        expect(mockProvider.fetchRefunds).toHaveBeenCalledTimes(1);
        expect(mockProvider.refund).toHaveBeenCalledTimes(1);
    });

    // BUG-R2-C1-A4-H1 — the duplicate-spend window this closes
    test('adopts a refund the provider already executed instead of paying twice', async () => {
        const user = await makeUser();
        const { order, intent } = await seedRefundableIntent(user);
        mockProvider.fetchRefunds.mockResolvedValue({
            items: [{ id: 'rfnd_already_paid', status: 'processed', notes: { requestId: 'rfnd_req_dup_1' } }],
        });

        const result = await createRefundForIntent({
            actorUserId: user._id,
            isAdmin: false,
            intentId: intent.intentId,
            amount: 1000,
            reason: 'customer_request',
            requestId: 'rfnd_req_dup_1',
        });

        expect(mockProvider.refund).not.toHaveBeenCalled();
        expect(result.refundId).toBe('rfnd_already_paid');

        // The ledger records the refund that actually happened, so the order
        // does not stay under-counted and re-arm the refundable balance.
        const stored = await Order.findById(order._id).lean();
        expect(stored.refundSummary.totalRefunded).toBe(1000);
    });

    // BUG-R2-C1-A4-H1 — fail-closed, but retryably
    test('does not execute the refund when provider reconciliation is unavailable', async () => {
        const user = await makeUser();
        const { intent } = await seedRefundableIntent(user);
        mockProvider.fetchRefunds.mockRejectedValue(new Error('refund read not permitted'));

        await expect(createRefundForIntent({
            actorUserId: user._id,
            isAdmin: false,
            intentId: intent.intentId,
            amount: 1000,
            reason: 'customer_request',
            requestId: 'rfnd_req_fetchfail_1',
        })).rejects.toMatchObject({ statusCode: 503 });

        expect(mockProvider.refund).not.toHaveBeenCalled();
    });

    // BUG-R2-C1-A2-H2 — the deterministic-key collision
    test('scopes the provider idempotency key to this request, not to the amount', async () => {
        const user = await makeUser();
        const { intent } = await seedRefundableIntent(user);
        mockProvider.refund.mockImplementation(async () => ({
            id: `rfnd_${Math.random().toString(36).slice(2, 10)}`,
            status: 'processed',
        }));

        await createRefundForIntent({
            actorUserId: user._id, isAdmin: false, intentId: intent.intentId,
            amount: 1000, reason: 'customer_request', requestId: 'rfnd_req_key_1',
        });
        await createRefundForIntent({
            actorUserId: user._id, isAdmin: false, intentId: intent.intentId,
            amount: 1000, reason: 'customer_request', requestId: 'rfnd_req_key_2',
        });

        const keys = mockProvider.refund.mock.calls.map((call) => call[0]?.notes?.idempotencyKey);
        expect(keys).toHaveLength(2);
        expect(keys[0]).toBe('rfnd_req_key_1');
        expect(keys[1]).toBe('rfnd_req_key_2');
        // The amount-derived fallback is what made two distinct same-amount
        // refunds collide into one Stripe replay.
        expect(keys[0]).not.toMatch(/^refund:/);
    });

    // BUG-R2-C1-A2-H2 — defence in depth against a provider replay
    test('refuses to advance the ledger when the provider replays a recorded refund', async () => {
        const user = await makeUser();
        const { order, intent } = await seedRefundableIntent(user);
        mockProvider.refund.mockResolvedValue({ id: 'rfnd_first', status: 'processed' });

        await createRefundForIntent({
            actorUserId: user._id, isAdmin: false, intentId: intent.intentId,
            amount: 1000, reason: 'customer_request', requestId: 'rfnd_req_replay_a',
        });

        const afterFirst = await Order.findById(order._id).lean();
        expect(afterFirst.refundSummary.totalRefunded).toBe(1000);

        // Provider hands back the SAME refund id for a different request: no new
        // money moved, so the ledger must not claim otherwise.
        await expect(createRefundForIntent({
            actorUserId: user._id, isAdmin: false, intentId: intent.intentId,
            amount: 1000, reason: 'customer_request', requestId: 'rfnd_req_replay_b',
        })).rejects.toMatchObject({ statusCode: 409 });

        const afterReplay = await Order.findById(order._id).lean();
        expect(afterReplay.refundSummary.totalRefunded).toBe(1000);
        expect(afterReplay.paymentState).toBe(PAYMENT_STATUSES.PARTIALLY_REFUNDED);
    });
});
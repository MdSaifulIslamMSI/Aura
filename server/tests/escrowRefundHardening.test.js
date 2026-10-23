const mockGetPaymentProvider = jest.fn();

jest.mock('../services/payments/providerFactory', () => ({
    getPaymentProvider: (...args) => mockGetPaymentProvider(...args),
}));

jest.mock('../services/email/adminActionEmailService', () => ({
    notifyAdminActionToUser: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../services/notificationService', () => ({
    sendPersistentNotification: jest.fn().mockResolvedValue(null),
}));

jest.mock('../services/fraudDecisioningService', () => ({
    assessFraudDecision: jest.fn().mockResolvedValue({
        blocked: false,
        reviewRequired: false,
        holdRequired: false,
        auditId: 'fraud_audit_escrow',
        strictDecision: 'allow',
        score: 5,
        factors: [],
    }),
}));

const PaymentIntent = require('../models/PaymentIntent');
const Listing = require('../models/Listing');
const { createEscrowRefundForIntent, releaseEscrowAuthorizationForIntent } = require('../services/payments/paymentService');
const { PAYMENT_STATUSES } = require('../services/payments/constants');
const { createTestUser } = require('./helpers/securityTestHelpers');

jest.setTimeout(30000);

const createEscrowListing = async ({ sellerId, buyerId, amount = 80000, intentId = 'intent_escrow_1' }) => Listing.create({
    seller: sellerId,
    title: 'Escrow regression listing',
    description: 'Listing used by the escrow refund hardening regression suite.',
    price: amount,
    condition: 'good',
    category: 'electronics',
    images: ['data:image/png;base64,iVBORw0KGgo='],
    location: { city: 'Bengaluru', state: 'Karnataka' },
    escrow: {
        enabled: true,
        state: 'held',
        buyer: buyerId,
        amount,
        paymentIntentId: intentId,
        holdReference: `ESC-${intentId}`,
        paymentState: PAYMENT_STATUSES.CAPTURED,
        startedAt: new Date(),
    },
});

const createCapturedIntent = async ({ buyerId, intentId = 'intent_escrow_1', amount = 80000 }) => PaymentIntent.create({
    intentId,
    user: buyerId,
    provider: 'razorpay',
    providerOrderId: `order_${intentId}`,
    providerPaymentId: `pay_${intentId}`,
    amount,
    currency: 'INR',
    method: 'UPI',
    status: PAYMENT_STATUSES.CAPTURED,
    metadata: { purpose: 'marketplace_escrow' },
});

describe('escrow refund hardening', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe('createEscrowRefundForIntent', () => {
        test('takes the refund lock and stamps a request id and idempotency key on the provider refund', async () => {
            const buyer = await createTestUser({ name: 'Escrow Buyer' });
            const intentId = 'intent_escrow_lock_1';
            await createCapturedIntent({ buyerId: buyer._id, intentId });

            const providerRefund = jest.fn().mockResolvedValue({ id: 'rfnd_provider_1' });
            const providerFetchRefunds = jest.fn().mockResolvedValue({ items: [] });
            mockGetPaymentProvider.mockResolvedValue({
                refund: providerRefund,
                fetchRefunds: providerFetchRefunds,
            });

            const result = await createEscrowRefundForIntent({
                intentId,
                amount: 80000,
                reason: 'marketplace_escrow_cancelled',
                requestId: `escrow-rfnd-${intentId}`,
                actorUserId: String(buyer._id),
            });

            expect(result.status).toBe('refunded');
            expect(result.refundId).toBe('rfnd_provider_1');

            // The provider call must carry a request id and an idempotency key
            // so a retried cancel resolves to the same refund.
            expect(providerRefund).toHaveBeenCalledTimes(1);
            const call = providerRefund.mock.calls[0][0];
            expect(call.notes.requestId).toBe(`escrow-rfnd-${intentId}`);
            expect(call.notes.idempotencyKey).toBe(`escrow-rfnd-${intentId}`);
            expect(call.notes.intentId).toBe(intentId);

            // The lock must be released again, otherwise no later refund on
            // this intent could ever run.
            const after = await PaymentIntent.findOne({ intentId }).lean();
            expect(after.status).toBe(PAYMENT_STATUSES.REFUNDED);
            expect(after.metadata.refundLock?.locked).toBeFalsy();
        });

        test('adopts a refund the provider already executed instead of paying out twice', async () => {
            const buyer = await createTestUser({ name: 'Escrow Retry Buyer' });
            const intentId = 'intent_escrow_retry_1';
            await createCapturedIntent({ buyerId: buyer._id, intentId });

            const providerRefund = jest.fn().mockResolvedValue({ id: 'rfnd_provider_2' });
            // The provider already has a refund stamped with this request id:
            // a previous attempt moved the money but the local write was lost.
            const providerFetchRefunds = jest.fn().mockResolvedValue({
                items: [{ id: 'rfnd_provider_2', notes: { requestId: `escrow-rfnd-${intentId}` } }],
            });
            mockGetPaymentProvider.mockResolvedValue({
                refund: providerRefund,
                fetchRefunds: providerFetchRefunds,
            });

            const result = await createEscrowRefundForIntent({
                intentId,
                amount: 80000,
                requestId: `escrow-rfnd-${intentId}`,
            });

            expect(result.status).toBe('refunded');
            // The provider must NOT be asked to refund a second time.
            expect(providerRefund).not.toHaveBeenCalled();
            expect(providerFetchRefunds).toHaveBeenCalledTimes(1);
        });

        test('refuses to refund when the provider refund state cannot be read', async () => {
            const buyer = await createTestUser({ name: 'Escrow Unreadable Buyer' });
            const intentId = 'intent_escrow_unreadable_1';
            await createCapturedIntent({ buyerId: buyer._id, intentId });

            const providerRefund = jest.fn().mockResolvedValue({ id: 'rfnd_provider_3' });
            const providerFetchRefunds = jest.fn().mockRejectedValue(new Error('provider read denied'));
            mockGetPaymentProvider.mockResolvedValue({
                refund: providerRefund,
                fetchRefunds: providerFetchRefunds,
            });

            await expect(createEscrowRefundForIntent({
                intentId,
                amount: 80000,
                requestId: `escrow-rfnd-${intentId}`,
            })).rejects.toThrow(/not executed/i);

            // Fail closed: no money moves when the provider state is unknown.
            expect(providerRefund).not.toHaveBeenCalled();
        });

        test('does not refund an intent that was already refunded', async () => {
            const buyer = await createTestUser({ name: 'Escrow Already Refunded' });
            const intentId = 'intent_escrow_already_1';
            await createCapturedIntent({ buyerId: buyer._id, intentId });
            await PaymentIntent.updateOne(
                { intentId },
                { $set: { status: PAYMENT_STATUSES.REFUNDED, 'metadata.escrowRefundId': 'rfnd_existing' } }
            );

            const providerRefund = jest.fn().mockResolvedValue({ id: 'rfnd_provider_4' });
            mockGetPaymentProvider.mockResolvedValue({ refund: providerRefund, fetchRefunds: jest.fn() });

            const result = await createEscrowRefundForIntent({
                intentId,
                amount: 80000,
                requestId: `escrow-rfnd-${intentId}`,
            });

            expect(result.status).toBe('refunded');
            expect(result.refundId).toBe('rfnd_existing');
            expect(providerRefund).not.toHaveBeenCalled();
        });

        test('adopts a refund recorded by a webhook while the provider call is in flight', async () => {
            const buyer = await createTestUser({ name: 'Escrow Webhook Race Buyer' });
            const intentId = 'intent_escrow_webhook_race_1';
            await createCapturedIntent({ buyerId: buyer._id, intentId });

            const providerRefund = jest.fn().mockImplementation(async () => {
                await PaymentIntent.updateOne(
                    { intentId },
                    {
                        $set: {
                            status: PAYMENT_STATUSES.REFUNDED,
                            'metadata.escrowRefundId': 'rfnd_webhook',
                        },
                    }
                );
                return { id: 'rfnd_provider_race' };
            });
            mockGetPaymentProvider.mockResolvedValue({
                refund: providerRefund,
                fetchRefunds: jest.fn().mockResolvedValue({ items: [] }),
            });

            const result = await createEscrowRefundForIntent({
                intentId,
                amount: 80000,
                requestId: `escrow-rfnd-${intentId}`,
            });

            expect(result.status).toBe('refunded');
            expect(result.refundId).toBe('rfnd_webhook');
            const after = await PaymentIntent.findOne({ intentId }).lean();
            expect(after.status).toBe(PAYMENT_STATUSES.REFUNDED);
            expect(after.metadata.escrowRefundId).toBe('rfnd_webhook');
            expect(after.metadata.refundLock?.locked).toBeFalsy();
        });

        test('refuses to refund an intent that is no longer captured', async () => {
            const buyer = await createTestUser({ name: 'Escrow Not Captured Buyer' });
            const intentId = 'intent_escrow_not_captured_1';
            await PaymentIntent.create({
                intentId,
                user: buyer._id,
                provider: 'razorpay',
                providerOrderId: `order_${intentId}`,
                providerPaymentId: `pay_${intentId}`,
                amount: 80000,
                currency: 'INR',
                method: 'UPI',
                status: PAYMENT_STATUSES.AUTHORIZED,
                metadata: { purpose: 'marketplace_escrow' },
            });

            const providerRefund = jest.fn();
            mockGetPaymentProvider.mockResolvedValue({
                refund: providerRefund,
                fetchRefunds: jest.fn(),
            });

            await expect(createEscrowRefundForIntent({
                intentId,
                amount: 80000,
                requestId: `escrow-rfnd-${intentId}`,
            })).rejects.toThrow(/requires a captured payment/i);

            expect(providerRefund).not.toHaveBeenCalled();
            const after = await PaymentIntent.findOne({ intentId }).lean();
            expect(after.status).toBe(PAYMENT_STATUSES.AUTHORIZED);
            expect(after.metadata.refundLock?.locked).toBeFalsy();
        });
    });

    describe('releaseEscrowAuthorizationForIntent', () => {
        test('cancels a Stripe authorization before expiring the local intent', async () => {
            const buyer = await createTestUser({ name: 'Escrow Stripe Buyer' });
            const intentId = 'intent_escrow_stripe_void_1';
            await PaymentIntent.create({
                intentId,
                user: buyer._id,
                provider: 'stripe',
                providerOrderId: 'pi_escrow_stripe_1',
                providerPaymentId: 'pi_escrow_stripe_1',
                amount: 80000,
                currency: 'INR',
                method: 'CARD',
                status: PAYMENT_STATUSES.AUTHORIZED,
                metadata: { purpose: 'marketplace_escrow' },
            });
            const cancelAuthorization = jest.fn().mockResolvedValue({ id: 'pi_escrow_stripe_1', status: 'canceled' });
            mockGetPaymentProvider.mockResolvedValue({ cancelAuthorization });

            const result = await releaseEscrowAuthorizationForIntent({
                intentId,
                actorUserId: String(buyer._id),
            });

            expect(result).toMatchObject({ status: PAYMENT_STATUSES.EXPIRED, providerRelease: 'canceled' });
            expect(cancelAuthorization).toHaveBeenCalledWith(expect.objectContaining({
                paymentId: 'pi_escrow_stripe_1',
                idempotencyKey: `escrow-void-${intentId}`,
            }));
            const after = await PaymentIntent.findOne({ intentId }).lean();
            expect(after.status).toBe(PAYMENT_STATUSES.EXPIRED);
            expect(after.metadata.escrowAuthorizationRelease).toMatchObject({
                mode: 'canceled',
                providerReference: 'pi_escrow_stripe_1',
            });
        });

        test('records the provider auto-refund when the gateway has no void API', async () => {
            const buyer = await createTestUser({ name: 'Escrow Razorpay Buyer' });
            const intentId = 'intent_escrow_razorpay_void_1';
            await PaymentIntent.create({
                intentId,
                user: buyer._id,
                provider: 'razorpay',
                providerOrderId: 'order_escrow_razorpay_void_1',
                providerPaymentId: 'pay_escrow_razorpay_1',
                amount: 80000,
                currency: 'INR',
                method: 'UPI',
                status: PAYMENT_STATUSES.AUTHORIZED,
                metadata: { purpose: 'marketplace_escrow' },
            });
            const cancelAuthorization = jest.fn();
            mockGetPaymentProvider.mockResolvedValue({ name: 'razorpay' });

            const result = await releaseEscrowAuthorizationForIntent({ intentId });

            expect(result).toMatchObject({
                status: PAYMENT_STATUSES.EXPIRED,
                providerRelease: 'provider_auto_refund',
            });
            expect(cancelAuthorization).not.toHaveBeenCalled();
            const after = await PaymentIntent.findOne({ intentId }).lean();
            expect(after.metadata.escrowAuthorizationRelease.mode).toBe('provider_auto_refund');
        });

        test('refuses to void a captured escrow', async () => {
            const buyer = await createTestUser({ name: 'Escrow Captured Buyer' });
            const intentId = 'intent_escrow_captured_void_1';
            await createCapturedIntent({ buyerId: buyer._id, intentId });

            await expect(releaseEscrowAuthorizationForIntent({ intentId }))
                .rejects.toThrow(/refunded, not released/i);
        });
    });

    describe('seller trust evidence separation', () => {
        test('a buyer-cancelled escrow does not count against the seller', async () => {
            const seller = await createTestUser({ name: 'Seller With Cancelled Escrow' });
            const buyer = await createTestUser({ name: 'Buyer Who Cancelled' });
            const listing = await createEscrowListing({ sellerId: seller._id, buyerId: buyer._id });
            listing.escrow.state = 'cancelled';
            listing.escrow.cancelledBy = String(buyer._id);
            listing.escrow.cancelledAt = new Date();
            await listing.save();

            const { buildSellerTrustPassport } = require('../services/sellerTrustService');
            const passport = await buildSellerTrustPassport({ sellerId: seller._id, sellerUser: seller });
            expect(passport.stats.escrowCancelled).toBe(0);
        });

        test('a seller-cancelled escrow does count against the seller', async () => {
            const seller = await createTestUser({ name: 'Seller Who Cancelled' });
            const buyer = await createTestUser({ name: 'Counterparty Buyer' });
            const listing = await createEscrowListing({
                sellerId: seller._id,
                buyerId: buyer._id,
                intentId: 'intent_escrow_seller_cancel',
            });
            listing.escrow.state = 'cancelled';
            listing.escrow.cancelledBy = String(seller._id);
            listing.escrow.cancelledAt = new Date();
            await listing.save();

            const { buildSellerTrustPassport } = require('../services/sellerTrustService');
            const passport = await buildSellerTrustPassport({ sellerId: seller._id, sellerUser: seller });
            expect(passport.stats.escrowCancelled).toBe(1);
        });
    });
});

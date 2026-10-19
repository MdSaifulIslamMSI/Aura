const express = require('express');
const request = require('supertest');

const mockAuthUsers = new Map();

jest.mock('../middleware/authMiddleware', () => ({
    protect: (req, res, next) => {
        const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
        const user = mockAuthUsers.get(token);
        if (!user) {
            return res.status(401).json({ message: 'Not authorized, token failed' });
        }
        req.user = user;
        req.authUid = user.authUid || String(user._id);
        req.requestId = 'req_refund_fulfilment_stop';
        return next();
    },
    admin: (req, res, next) => {
        if (!req.user?.isAdmin) {
            return res.status(403).json({ message: 'Not authorized as an admin' });
        }
        return next();
    },
    requireOtpAssurance: (_req, _res, next) => next(),
    requireActiveAccount: (_req, _res, next) => next(),
}));

jest.mock('../middleware/routeSecurityGuards', () => ({
    authorizeOrderOwner: () => (_req, _res, next) => next(),
    sensitiveActions: new Proxy({}, { get: () => (_req, _res, next) => next() }),
}));

jest.mock('../trust/middleware/requireTrustDecision', () => ({
    requireTrustDecision: () => (_req, _res, next) => next(),
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
        auditId: 'fraud_audit_refund_stop',
        strictDecision: 'allow',
        score: 10,
        factors: [],
    }),
}));

const mockCreateRefundForIntent = jest.fn();

jest.mock('../services/payments/paymentService', () => ({
    createRefundForIntent: mockCreateRefundForIntent,
    // The write-ahead behavior under test depends on a REAL outbox task row,
    // so the scheduler stays live even though the provider call is mocked.
    scheduleRefundTask: require('../services/payments/outboxState').scheduleRefundTask,
    setTerminalCaptureFailureHandler: jest.fn(),
}));

const Order = require('../models/Order');
const Product = require('../models/Product');
const User = require('../models/User');
const Listing = require('../models/Listing');
const CouponRedemption = require('../models/CouponRedemption');
const orderRoutes = require('../routes/orderRoutes');
const { buildSellerTrustPassport } = require('../services/sellerTrustService');
const {
    buildBearer,
    createFakeOrder,
    createFakeProduct,
    createTestUser,
} = require('./helpers/securityTestHelpers');

jest.setTimeout(30000);

// The refund side effects run inside a real Mongo transaction. When the
// in-memory Mongo is allowed (local/PR dev runs), opt this file's setup into a
// transaction-capable replica set; the flag is scoped to this file and cleared
// in afterAll. CI provides a standalone mongod (TEST_USE_IN_MEMORY_MONGO=false),
// where the transaction-dependent tests skip rather than fail.
const usingInMemoryMongo = process.env.TEST_USE_IN_MEMORY_MONGO !== 'false';
const transactionUriProvided = /replicaSet=/i.test(String(process.env.TEST_MONGO_URI || ''))
    || String(process.env.TEST_MONGO_TRANSACTION_CAPABLE || '') === 'true';
const transactionsAvailable = usingInMemoryMongo || transactionUriProvided;
if (usingInMemoryMongo) {
    process.env.TEST_REQUIRE_TRANSACTION_MONGO = 'true';
}
const describeWithTransactions = transactionsAvailable ? describe : describe.skip;

const register = (token, user) => {
    mockAuthUsers.set(token, {
        _id: user._id,
        id: String(user._id),
        email: user.email,
        name: user.name,
        authUid: user.authUid,
        isAdmin: Boolean(user.isAdmin),
    });
};

const buildApp = () => {
    const app = express();
    app.use(express.json());
    app.use('/api/orders', orderRoutes);
    app.use((err, _req, res, _next) => {
        res.status(err.statusCode || err.status || 500).json({
            message: err.message || 'Internal Server Error',
        });
    });
    return app;
};

const createListing = async ({ sellerId, overrides = {} } = {}) => Listing.create({
    seller: sellerId,
    title: 'Refactor fixture listing',
    description: 'Listing used by the refund fulfilment-stop regression suite.',
    price: 1999,
    condition: 'good',
    category: 'electronics',
    images: ['data:image/png;base64,iVBORw0KGgo='],
    location: { city: 'Bengaluru', state: 'Karnataka' },
    ...overrides,
});

describe('refund fulfilment stop and commerce side-effect unwind', () => {
    let app;

    afterAll(() => {
        if (usingInMemoryMongo) {
            delete process.env.TEST_REQUIRE_TRANSACTION_MONGO;
        }
    });

    beforeEach(() => {
        jest.clearAllMocks();
        mockAuthUsers.clear();
        mockCreateRefundForIntent.mockResolvedValue({ refundId: 'rfnd_stop_1', status: 'processed' });
        app = buildApp();
    });

    describeWithTransactions('buyer-initiated pre-shipment refund', () => {
        test('a full refund cancels the order so it can no longer ship', async () => {
            const owner = await createTestUser({ name: 'Refund Owner' });
            register('token-refund-stop-1', owner);
            const product = await createFakeProduct({ stock: 10 });
            const order = await createFakeOrder({
                userId: owner._id,
                product,
                paymentIntentId: 'intent_refund_stop_1',
                paymentState: 'captured',
                isPaid: true,
                orderStatus: 'placed',
            });

            const response = await request(app)
                .post(`/api/orders/${order._id}/command-center/refund`)
                .set('Authorization', buildBearer('token-refund-stop-1'))
                .send({ reason: 'Changed my mind' });

            expect(response.status).toBe(201);

            const orderAfter = await Order.findById(order._id).lean();
            // The money is already back, so the order must not stay shippable.
            expect(orderAfter.orderStatus).toBe('cancelled');
            expect(orderAfter.cancelledAt).toBeTruthy();
            // A refunded order is no longer a paid order.
            expect(orderAfter.isPaid).toBe(false);
            expect(orderAfter.paidAt).toBeNull();
        });

        test('a full refund releases the coupon, claws back loyalty and restores stock', async () => {
            const owner = await createTestUser({ name: 'Refund Unwind Owner' });
            register('token-refund-stop-2', owner);
            await User.updateOne(
                { _id: owner._id },
                { $set: { 'loyalty.pointsBalance': 100, 'loyalty.lifetimeEarned': 100 } }
            );
            const product = await createFakeProduct({ stock: 10 });
            const order = await createFakeOrder({
                userId: owner._id,
                product,
                paymentIntentId: 'intent_refund_stop_2',
                paymentState: 'captured',
                isPaid: true,
                orderStatus: 'placed',
                overrides: {
                    couponCode: 'AURA10',
                    loyaltyPointsAwarded: 40,
                },
            });
            await CouponRedemption.create({
                code: 'AURA10',
                user: owner._id,
                order: order._id,
                discount: 100,
            });

            const response = await request(app)
                .post(`/api/orders/${order._id}/command-center/refund`)
                .set('Authorization', buildBearer('token-refund-stop-2'))
                .send({ reason: 'Changed my mind' });

            expect(response.status).toBe(201);

            const redemption = await CouponRedemption.findOne({ code: 'AURA10', user: owner._id }).lean();
            expect(redemption).toBeNull();

            const ownerAfter = await User.findById(owner._id).select('loyalty').lean();
            expect(ownerAfter.loyalty.pointsBalance).toBe(60);

            const productAfter = await Product.findById(product._id).select('stock').lean();
            expect(productAfter.stock).toBe(11);
        });

        test('a partial refund leaves the order open for fulfilment', async () => {
            const owner = await createTestUser({ name: 'Partial Refund Owner' });
            register('token-refund-stop-3', owner);
            const product = await createFakeProduct({ stock: 10 });
            const order = await createFakeOrder({
                userId: owner._id,
                product,
                totalPrice: 1999,
                paymentIntentId: 'intent_refund_stop_3',
                paymentState: 'captured',
                isPaid: true,
                orderStatus: 'placed',
            });

            const response = await request(app)
                .post(`/api/orders/${order._id}/command-center/refund`)
                .set('Authorization', buildBearer('token-refund-stop-3'))
                .send({ reason: 'One item unavailable', amount: 500 });

            expect(response.status).toBe(201);

            const orderAfter = await Order.findById(order._id).lean();
            // A partial refund leaves part of the order to be delivered, so the
            // order stays open and stays paid.
            expect(orderAfter.orderStatus).toBe('placed');
            expect(orderAfter.isPaid).toBe(true);
        });
    });

    describe('seller trust passport requires evidence-backed transactions', () => {
        test('self-declared sales never earn the trusted-seller badge', async () => {
            const seller = await createTestUser({ name: 'Declaring Seller' });
            for (let index = 0; index < 10; index += 1) {
                await createListing({
                    sellerId: seller._id,
                    overrides: { status: 'sold', soldAt: new Date() },
                });
            }

            const passport = await buildSellerTrustPassport({ sellerId: seller._id, sellerUser: seller });
            expect(passport.verifiedBadges).not.toContain('trusted_seller');
            expect(passport.stats.verifiedTransactions).toBe(0);
            expect(passport.stats.declaredSoldListings).toBe(10);
        });

        test('self-declared sales cannot dilute a real dispute rate into the low-risk tier', async () => {
            const seller = await createTestUser({ name: 'Disputing Seller' });
            // Three seller-attributed escrow cancellations: a real red flag.
            for (let index = 0; index < 3; index += 1) {
                await createListing({
                    sellerId: seller._id,
                    overrides: {
                        status: 'active',
                        escrow: {
                            enabled: true,
                            state: 'cancelled',
                            cancelledBy: String(seller._id),
                            cancelledAt: new Date(),
                        },
                    },
                });
            }
            // Ten self-declared sales: the dilution attempt.
            for (let index = 0; index < 10; index += 1) {
                await createListing({
                    sellerId: seller._id,
                    overrides: { status: 'sold', soldAt: new Date() },
                });
            }

            const passport = await buildSellerTrustPassport({ sellerId: seller._id, sellerUser: seller });
            // Before the fix the declared sales inflated the dispute-rate
            // denominator and pushed the seller into the low-risk tier.
            expect(passport.fraudRiskTier).toBe('high');
        });

        test('evidence-backed escrow releases still earn trust', async () => {
            const seller = await createTestUser({ name: 'Verified Seller' });
            for (let index = 0; index < 10; index += 1) {
                const startedAt = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
                await createListing({
                    sellerId: seller._id,
                    overrides: {
                        status: 'sold',
                        soldAt: new Date(),
                        escrow: {
                            enabled: true,
                            state: 'released',
                            startedAt,
                            releasedAt: new Date(),
                        },
                    },
                });
            }

            const passport = await buildSellerTrustPassport({ sellerId: seller._id, sellerUser: seller });
            expect(passport.verifiedBadges).toContain('trusted_seller');
            expect(passport.stats.verifiedTransactions).toBe(10);
            expect(passport.fraudRiskTier).toBe('low');
        });

        test('a buyer releasing their own escrow is not counted against the seller', async () => {
            const seller = await createTestUser({ name: 'Seller With Buyer Cancellations' });
            const buyer = await createTestUser({ name: 'Cancelling Buyer' });
            await createListing({
                sellerId: seller._id,
                overrides: {
                    status: 'active',
                    escrow: {
                        enabled: true,
                        state: 'cancelled',
                        cancelledBy: String(buyer._id),
                        cancelledAt: new Date(),
                    },
                },
            });

            const passport = await buildSellerTrustPassport({ sellerId: seller._id, sellerUser: seller });
            expect(passport.stats.escrowCancelled).toBe(0);
            expect(passport.fraudRiskTier).toBe('low');
        });
    });
});

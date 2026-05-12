const mongoose = require('mongoose');
const PaymentIntent = require('../models/PaymentIntent');
const Listing = require('../models/Listing');
const User = require('../models/User');
const FraudDecision = require('../models/FraudDecision');
const Order = require('../models/Order');
const ProductReview = require('../models/ProductReview');
const {
    DECISIONS,
    assessFraudDecision,
    buildDecision,
} = require('../services/fraudDecisioningService');

const makeProviderOrderId = (suffix) => `order_fraud_${suffix}_${Date.now()}`;

describe('fraudDecisioningService', () => {
    test('blocks high-risk payment attempts in enforce mode and writes an audit decision', async () => {
        const userId = new mongoose.Types.ObjectId();
        await PaymentIntent.create([
            {
                intentId: 'pi_fraud_1',
                user: userId,
                provider: 'razorpay',
                providerOrderId: makeProviderOrderId('1'),
                amount: 51000,
                currency: 'INR',
                method: 'CARD',
                status: 'failed',
                metadata: { ip: '203.0.113.10' },
            },
            {
                intentId: 'pi_fraud_2',
                user: userId,
                provider: 'razorpay',
                providerOrderId: makeProviderOrderId('2'),
                amount: 51000,
                currency: 'INR',
                method: 'CARD',
                status: 'failed',
                metadata: { ip: '203.0.113.10' },
            },
            {
                intentId: 'pi_fraud_3',
                user: userId,
                provider: 'razorpay',
                providerOrderId: makeProviderOrderId('3'),
                amount: 51000,
                currency: 'INR',
                method: 'CARD',
                status: 'expired',
                metadata: { ip: '203.0.113.10' },
            },
            {
                intentId: 'pi_fraud_4',
                user: userId,
                provider: 'razorpay',
                providerOrderId: makeProviderOrderId('4'),
                amount: 51000,
                currency: 'INR',
                method: 'CARD',
                status: 'created',
                metadata: { ip: '203.0.113.10' },
            },
        ]);

        const decision = await assessFraudDecision({
            action: 'payment_intent',
            userId,
            amount: 51000,
            deviceContext: {},
            requestMeta: {
                ip: '203.0.113.10',
                userAgent: '',
            },
            shippingAddress: {
                postalCode: '12',
            },
            mode: 'enforce',
            subject: { type: 'checkout', id: 'cart_fraud' },
        });

        expect(decision.strictDecision).toBe(DECISIONS.BLOCK);
        expect(decision.decision).toBe(DECISIONS.BLOCK);
        expect(decision.blocked).toBe(true);
        expect(decision.factors).toEqual(expect.arrayContaining([
            'high_amount_50k_plus',
            'high_attempt_velocity_10m',
            'recent_failures_24h',
        ]));
        await expect(FraudDecision.findOne({ decisionId: decision.auditId }).lean())
            .resolves
            .toMatchObject({
                action: 'payment_intent',
                decision: DECISIONS.BLOCK,
                outcome: expect.objectContaining({ blocked: true }),
            });
    });

    test('turns marketplace listing integrity failures into enforced blocks', async () => {
        const decision = await assessFraudDecision({
            action: 'marketplace_listing_create',
            listingInput: {
                title: 'Demo listing',
                description: 'sample listing from seed data',
                images: ['https://picsum.photos/200/200'],
            },
            mode: 'enforce',
        });

        expect(decision.strictDecision).toBe(DECISIONS.BLOCK);
        expect(decision.blocked).toBe(true);
        expect(decision.message).toMatch(/demo|sample/i);
        expect(decision.factors).toContain('listing_integrity_block');
    });

    test('treats escrow payment intents as payment challenges instead of review cases', async () => {
        const decision = await assessFraudDecision({
            action: 'escrow_payment_intent',
            userId: new mongoose.Types.ObjectId(),
            amount: 51000,
            deviceContext: {},
            requestMeta: {
                ip: '203.0.113.20',
                userAgent: '',
            },
            shippingAddress: {
                postalCode: '1',
            },
            mode: 'enforce',
        });

        expect(decision.strictDecision).toBe(DECISIONS.CHALLENGE);
        expect(decision.challengeRequired).toBe(true);
        expect(decision.reviewRequired).toBe(false);
    });

    test('challenges payments linked to a shared device identity graph', async () => {
        const currentUserId = new mongoose.Types.ObjectId();
        const sharedDeviceId = 'device-fingerprint-shared-001';
        await PaymentIntent.create([1, 2, 3].map((index) => ({
            intentId: `pi_device_${index}`,
            user: new mongoose.Types.ObjectId(),
            provider: 'razorpay',
            providerOrderId: makeProviderOrderId(`device_${index}`),
            amount: 1200,
            currency: 'INR',
            method: 'CARD',
            status: 'created',
            metadata: {
                deviceContext: { deviceId: sharedDeviceId },
            },
        })));

        const decision = await assessFraudDecision({
            action: 'payment_intent',
            userId: currentUserId,
            amount: 1200,
            deviceContext: { deviceId: sharedDeviceId },
            requestMeta: {},
            shippingAddress: { postalCode: '560001' },
            mode: 'enforce',
        });

        expect(decision.strictDecision).toBe(DECISIONS.CHALLENGE);
        expect(decision.challengeRequired).toBe(true);
        expect(decision.factors).toContain('shared_device_multi_account');
    });

    test('challenges payment attempts with high same-coupon velocity', async () => {
        const userId = new mongoose.Types.ObjectId();
        await Order.create([1, 2, 3].map((index) => ({
            user: userId,
            orderItems: [{
                title: `Coupon Item ${index}`,
                quantity: 1,
                image: 'https://example.com/item.jpg',
                price: 1000,
                product: new mongoose.Types.ObjectId(),
            }],
            shippingAddress: {
                address: 'MG Road',
                city: 'Bengaluru',
                postalCode: '560001',
                country: 'India',
            },
            paymentMethod: 'UPI',
            totalPrice: 1000,
            couponCode: 'SAVE100',
        })));

        const decision = await assessFraudDecision({
            action: 'payment_intent',
            userId,
            amount: 1000,
            deviceContext: {},
            requestMeta: {},
            shippingAddress: { postalCode: '560001' },
            metadata: { couponCode: 'SAVE100' },
            mode: 'enforce',
        });

        expect(decision.strictDecision).toBe(DECISIONS.CHALLENGE);
        expect(decision.factors).toContain('coupon_velocity_user_24h');
    });

    test('holds refund requests with repeated refund history', async () => {
        const userId = new mongoose.Types.ObjectId();
        const baseOrder = (index, extra = {}) => ({
            user: userId,
            orderItems: [{
                title: `Refund Item ${index}`,
                quantity: 1,
                image: 'https://example.com/refund.jpg',
                price: 2500,
                product: new mongoose.Types.ObjectId(),
            }],
            shippingAddress: {
                address: 'Brigade Road',
                city: 'Bengaluru',
                postalCode: '560001',
                country: 'India',
            },
            paymentMethod: 'UPI',
            totalPrice: 2500,
            isDelivered: true,
            commandCenter: {
                refunds: [{
                    requestId: `rfnd_history_${index}`,
                    amount: 2500,
                    reason: 'damaged item',
                    status: 'processed',
                    createdAt: new Date(),
                }],
            },
            ...extra,
        });
        await Order.create([1, 2, 3, 4].map((index) => baseOrder(index)));
        const currentOrder = await Order.create(baseOrder('current', {
            commandCenter: { refunds: [] },
        }));

        const decision = await assessFraudDecision({
            action: 'order_refund_request',
            userId,
            order: currentOrder.toObject(),
            amount: 2400,
            reason: 'damaged package',
            mode: 'enforce',
        });

        expect(decision.strictDecision).toBe(DECISIONS.HOLD);
        expect(decision.holdRequired).toBe(true);
        expect(decision.factors).toContain('refund_velocity_user_30d');
    });

    test('sends duplicate review text to integrity review', async () => {
        const productId = new mongoose.Types.ObjectId();
        const duplicateComment = 'Amazing product quality and fast delivery';
        await ProductReview.create([1, 2].map((index) => ({
            product: productId,
            user: new mongoose.Types.ObjectId(),
            order: new mongoose.Types.ObjectId(),
            rating: 5,
            comment: duplicateComment,
            isVerifiedPurchase: true,
            status: 'published',
        })));

        const decision = await assessFraudDecision({
            action: 'product_review_submit',
            userId: new mongoose.Types.ObjectId(),
            productId,
            reviewInput: {
                rating: 5,
                comment: duplicateComment,
                media: [],
            },
            mode: 'enforce',
        });

        expect(decision.strictDecision).toBe(DECISIONS.REVIEW);
        expect(decision.reviewRequired).toBe(true);
        expect(decision.factors).toContain('duplicate_review_text');
    });

    test('routes high-risk seller history into manual review decisions', async () => {
        const seller = await User.create({
            name: 'Risky Seller',
            email: 'risky.seller@example.com',
            phone: '9000000001',
            isVerified: true,
            isSeller: true,
        });

        await Listing.create([1, 2, 3].map((index) => ({
            seller: seller._id,
            title: `Escrow Cancelled ${index}`,
            description: 'Real listing with cancelled escrow history',
            price: 2000 + index,
            condition: 'good',
            category: 'electronics',
            images: [`https://example.com/item-${index}.jpg`],
            location: {
                city: 'Bengaluru',
                state: 'Karnataka',
                pincode: '560001',
            },
            escrow: { state: 'cancelled' },
            source: 'user',
        })));

        const decision = await assessFraudDecision({
            action: 'marketplace_listing_create',
            user: seller,
            sellerId: seller._id,
            listingInput: {
                title: 'Real phone',
                description: 'Original phone with invoice and real photos',
                images: ['https://example.com/phone.jpg'],
            },
            mode: 'enforce',
        });

        expect(decision.strictDecision).toBe(DECISIONS.REVIEW);
        expect(decision.reviewRequired).toBe(true);
        expect(decision.factors).toContain('seller_high_fraud_tier');
    });

    test('keeps decisions available when audit persistence fails', async () => {
        const createSpy = jest
            .spyOn(FraudDecision, 'create')
            .mockRejectedValueOnce(new Error('audit store unavailable'));

        const decision = await buildDecision({
            action: 'marketplace_listing_create',
            mode: 'enforce',
            signals: [{
                code: 'forced_test_block',
                source: 'test',
                points: 100,
                severity: 'critical',
                message: 'Test block',
            }],
            forcedDecision: DECISIONS.BLOCK,
        });

        expect(decision.blocked).toBe(true);
        expect(decision.auditId).toBeNull();
        expect(createSpy).toHaveBeenCalled();
        createSpy.mockRestore();
    });
});

const PaymentIntent = require('../models/PaymentIntent');
const Listing = require('../models/Listing');
const { PAYMENT_STATUSES } = require('../services/payments/constants');
const { createTestUser } = require('./helpers/securityTestHelpers');

jest.doMock('../services/payments/providerFactory', () => ({
    getPaymentProvider: jest.fn(),
}));

const { getPaymentProvider } = require('../services/payments/providerFactory');
const { confirmEscrowIntent } = require('../controllers/listingController');

jest.setTimeout(30_000);

const LISTING_PRICE = 500;

const createListing = async ({ sellerId }) => Listing.create({
    seller: sellerId,
    title: 'Escrow confirmation hardening listing',
    description: 'Listing used by the escrow confirmation hardening suite.',
    price: LISTING_PRICE,
    condition: 'good',
    category: 'electronics',
    images: ['data:image/png;base64,iVBORw0KGgo='],
    location: { city: 'Bengaluru', state: 'Karnataka' },
    escrowOptIn: true,
    status: 'active',
});

const createIntent = async ({
    buyerId,
    sellerId,
    listingId,
    intentId,
    overrides = {},
}) => PaymentIntent.create({
    intentId,
    user: buyerId,
    provider: 'razorpay',
    providerOrderId: `order_${intentId}`,
    amount: LISTING_PRICE,
    currency: 'INR',
    method: 'UPI',
    status: PAYMENT_STATUSES.CREATED,
    expiresAt: new Date(Date.now() + 15 * 60 * 1000),
    metadata: {
        purpose: 'marketplace_escrow',
        listingId: String(listingId),
        sellerId: String(sellerId),
    },
    ...overrides,
});

const buildProvider = ({ payment, verified = true } = {}) => ({
    verifySignature: jest.fn(() => verified),
    fetchPayment: jest.fn().mockResolvedValue(payment),
    parsePaymentAmounts: jest.fn(() => ({
        amount: LISTING_PRICE,
        currency: 'INR',
    })),
    parsePaymentMethod: jest.fn(() => ({
        type: 'upi',
        providerMethodId: 'upi_h7',
    })),
});

const invoke = async ({ user, listingId, intentId, body = {} }) => {
    const req = {
        user,
        params: { id: String(listingId), intentId },
        body,
    };
    const res = { json: jest.fn((payload) => payload) };
    const next = jest.fn();
    await confirmEscrowIntent(req, res, next);
    return { res, next };
};

const buildConfirmationBody = (intentId, overrides = {}) => ({
    providerOrderId: `order_${intentId}`,
    providerPaymentId: `pay_${intentId}`,
    providerSignature: 'valid-signature',
    ...overrides,
});

describe('escrow confirmation hardening', () => {
    beforeEach(() => {
        getPaymentProvider.mockReset();
    });

    test('rejects a provider payment that is not authorized or captured', async () => {
        const seller = await createTestUser({ name: 'H7 Seller' });
        const buyer = await createTestUser({ name: 'H7 Buyer' });
        const listing = await createListing({ sellerId: seller._id });
        const intent = await createIntent({
            buyerId: buyer._id,
            sellerId: seller._id,
            listingId: listing._id,
            intentId: 'intent_h7_failed_status',
        });
        getPaymentProvider.mockResolvedValue(buildProvider({
            payment: {
                id: 'pay_intent_h7_failed_status',
                order_id: intent.providerOrderId,
                status: 'failed',
            },
        }));

        const { next } = await invoke({
            user: buyer,
            listingId: listing._id,
            intentId: intent.intentId,
            body: buildConfirmationBody(intent.intentId),
        });

        expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 409 }));
        const stored = await PaymentIntent.findById(intent._id).lean();
        expect(stored.status).toBe(PAYMENT_STATUSES.CREATED);
        expect(stored.metadata.securityLayer.failedConfirmAttempts).toBe(1);
    });

    test('rejects a payment that belongs to a different provider order', async () => {
        const seller = await createTestUser({ name: 'H7 Order Seller' });
        const buyer = await createTestUser({ name: 'H7 Order Buyer' });
        const listing = await createListing({ sellerId: seller._id });
        const intent = await createIntent({
            buyerId: buyer._id,
            sellerId: seller._id,
            listingId: listing._id,
            intentId: 'intent_h7_order_mismatch',
        });
        getPaymentProvider.mockResolvedValue(buildProvider({
            payment: {
                id: 'pay_intent_h7_order_mismatch',
                order_id: 'order_someone_else',
                status: 'captured',
            },
        }));

        const { next } = await invoke({
            user: buyer,
            listingId: listing._id,
            intentId: intent.intentId,
            body: buildConfirmationBody(intent.intentId),
        });

        expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 409 }));
        const stored = await PaymentIntent.findById(intent._id).lean();
        expect(stored.status).toBe(PAYMENT_STATUSES.CREATED);
    });

    test('rejects a provider payment already bound to another intent', async () => {
        const seller = await createTestUser({ name: 'H7 Reuse Seller' });
        const buyer = await createTestUser({ name: 'H7 Reuse Buyer' });
        const listing = await createListing({ sellerId: seller._id });
        const intent = await createIntent({
            buyerId: buyer._id,
            sellerId: seller._id,
            listingId: listing._id,
            intentId: 'intent_h7_reuse_target',
        });
        await createIntent({
            buyerId: buyer._id,
            sellerId: seller._id,
            listingId: listing._id,
            intentId: 'intent_h7_reuse_existing',
            overrides: {
                providerPaymentId: 'pay_intent_h7_reuse_target',
                status: PAYMENT_STATUSES.AUTHORIZED,
            },
        });
        getPaymentProvider.mockResolvedValue(buildProvider({
            payment: {
                id: 'pay_intent_h7_reuse_target',
                order_id: intent.providerOrderId,
                status: 'captured',
            },
        }));

        const { next } = await invoke({
            user: buyer,
            listingId: listing._id,
            intentId: intent.intentId,
            body: buildConfirmationBody(intent.intentId),
        });

        expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 409 }));
        const stored = await PaymentIntent.findById(intent._id).lean();
        expect(stored.status).toBe(PAYMENT_STATUSES.CREATED);
    });

    test('accepts a captured payment bound to the intent order and uses the intent gateway', async () => {
        const seller = await createTestUser({ name: 'H7 Accept Seller' });
        const buyer = await createTestUser({ name: 'H7 Accept Buyer' });
        const listing = await createListing({ sellerId: seller._id });
        const intent = await createIntent({
            buyerId: buyer._id,
            sellerId: seller._id,
            listingId: listing._id,
            intentId: 'intent_h7_accept',
        });
        getPaymentProvider.mockResolvedValue(buildProvider({
            payment: {
                id: 'pay_intent_h7_accept',
                order_id: intent.providerOrderId,
                status: 'captured',
            },
        }));

        const { res, next } = await invoke({
            user: buyer,
            listingId: listing._id,
            intentId: intent.intentId,
            body: buildConfirmationBody(intent.intentId),
        });

        expect(next).not.toHaveBeenCalled();
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
            intentId: intent.intentId,
            status: PAYMENT_STATUSES.CAPTURED,
        }));
        expect(getPaymentProvider).toHaveBeenCalledWith(expect.objectContaining({
            gatewayId: 'razorpay',
        }));
        const stored = await PaymentIntent.findById(intent._id).lean();
        expect(stored.status).toBe(PAYMENT_STATUSES.CAPTURED);
        expect(stored.providerPaymentId).toBe('pay_intent_h7_accept');
    });

    test('blocks confirmation while the intent is security-locked', async () => {
        const seller = await createTestUser({ name: 'H7 Lock Seller' });
        const buyer = await createTestUser({ name: 'H7 Lock Buyer' });
        const listing = await createListing({ sellerId: seller._id });
        const intent = await createIntent({
            buyerId: buyer._id,
            sellerId: seller._id,
            listingId: listing._id,
            intentId: 'intent_h7_locked',
            overrides: {
                metadata: {
                    purpose: 'marketplace_escrow',
                    listingId: String(listing._id),
                    sellerId: String(seller._id),
                    securityLayer: {
                        failedConfirmAttempts: 5,
                        lockedUntil: new Date(Date.now() + 60_000).toISOString(),
                    },
                },
            },
        });

        const { next } = await invoke({
            user: buyer,
            listingId: listing._id,
            intentId: intent.intentId,
            body: buildConfirmationBody(intent.intentId),
        });

        expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 429 }));
        expect(getPaymentProvider).not.toHaveBeenCalled();
    });
});

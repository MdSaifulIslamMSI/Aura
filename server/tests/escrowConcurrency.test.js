const PaymentIntent = require('../models/PaymentIntent');
const Listing = require('../models/Listing');
const { startEscrow, confirmEscrowIntent, confirmEscrowDelivery } = require('../controllers/listingController');
const { PAYMENT_STATUSES } = require('../services/payments/constants');
const { createTestUser } = require('./helpers/securityTestHelpers');

jest.setTimeout(30000);

const LISTING_PRICE = 500;

const createListing = async ({ sellerId, overrides = {} }) => Listing.create({
    seller: sellerId,
    title: 'Escrow concurrency listing',
    description: 'Listing used by the escrow concurrency regression suite.',
    price: LISTING_PRICE,
    condition: 'good',
    category: 'electronics',
    images: ['data:image/png;base64,iVBORw0KGgo='],
    location: { city: 'Bengaluru', state: 'Karnataka' },
    escrowOptIn: true,
    status: 'active',
    ...overrides,
});

const createEscrowIntent = async ({
    buyerId,
    sellerId,
    listingId,
    intentId,
    status = PAYMENT_STATUSES.AUTHORIZED,
    expiresAt = new Date(Date.now() + 15 * 60 * 1000),
}) => PaymentIntent.create({
    intentId,
    user: buyerId,
    provider: 'razorpay',
    providerOrderId: `order_${intentId}`,
    providerPaymentId: `pay_${intentId}`,
    amount: LISTING_PRICE,
    currency: 'INR',
    method: 'UPI',
    status,
    authorizedAt: status === PAYMENT_STATUSES.AUTHORIZED ? new Date() : null,
    capturedAt: status === PAYMENT_STATUSES.CAPTURED ? new Date() : null,
    expiresAt,
    metadata: {
        purpose: 'marketplace_escrow',
        listingId: String(listingId),
        sellerId: String(sellerId),
    },
});

const invoke = async (handler, { user, listingId, body = {}, params = {} }) => {
    const req = {
        user,
        params: { id: String(listingId), ...params },
        body,
    };
    const res = {
        json: jest.fn((payload) => payload),
    };
    const next = jest.fn();
    await handler(req, res, next);
    return { res, next };
};

describe('escrow concurrency hardening', () => {
    afterEach(() => {
        jest.restoreAllMocks();
    });

    test('only one concurrent startEscrow call can claim the listing hold', async () => {
        const seller = await createTestUser({ name: 'Escrow Seller' });
        const buyerOne = await createTestUser({ name: 'Escrow Buyer One' });
        const buyerTwo = await createTestUser({ name: 'Escrow Buyer Two' });
        const listing = await createListing({ sellerId: seller._id });
        const intentOne = await createEscrowIntent({
            buyerId: buyerOne._id,
            sellerId: seller._id,
            listingId: listing._id,
            intentId: 'intent_concurrent_start_1',
        });
        const intentTwo = await createEscrowIntent({
            buyerId: buyerTwo._id,
            sellerId: seller._id,
            listingId: listing._id,
            intentId: 'intent_concurrent_start_2',
        });

        // Hold both requests after they have read the listing and their intent,
        // so the race is exercised at the conditional write rather than
        // accidentally serialising at the first database read.
        let arrivals = 0;
        let releaseBoth;
        const bothArrived = new Promise((resolve) => { releaseBoth = resolve; });
        const originalFindOne = PaymentIntent.findOne;
        jest.spyOn(PaymentIntent, 'findOne').mockImplementation(async (...args) => {
            const intent = await originalFindOne.apply(PaymentIntent, args);
            arrivals += 1;
            if (arrivals === 2) releaseBoth();
            await bothArrived;
            return intent;
        });

        const [first, second] = await Promise.all([
            invoke(startEscrow, {
                user: buyerOne,
                listingId: listing._id,
                body: { paymentIntentId: intentOne.intentId },
            }),
            invoke(startEscrow, {
                user: buyerTwo,
                listingId: listing._id,
                body: { paymentIntentId: intentTwo.intentId },
            }),
        ]);

        const successes = [first, second].filter(({ next }) => next.mock.calls.length === 0);
        const conflicts = [first, second].filter(({ next }) => {
            const [error] = next.mock.calls[0] || [];
            return error?.statusCode === 409;
        });

        expect(successes).toHaveLength(1);
        expect(conflicts).toHaveLength(1);

        const stored = await Listing.findById(listing._id).lean();
        expect(stored.escrow.state).toBe('held');
        expect([intentOne.intentId, intentTwo.intentId]).toContain(stored.escrow.paymentIntentId);
    });

    test('does not expire an already-captured intent when startEscrow reads a stale expiry', async () => {
        const seller = await createTestUser({ name: 'Stale Start Seller' });
        const buyer = await createTestUser({ name: 'Stale Start Buyer' });
        const listing = await createListing({ sellerId: seller._id });
        const intent = await createEscrowIntent({
            buyerId: buyer._id,
            sellerId: seller._id,
            listingId: listing._id,
            intentId: 'intent_stale_start_1',
            status: PAYMENT_STATUSES.AUTHORIZED,
            expiresAt: new Date(Date.now() - 60 * 1000),
        });

        // Model the read/write gap: this handler loaded AUTHORIZED, then a
        // provider webhook marked the intent CAPTURED before the expiry write.
        const staleIntent = await PaymentIntent.findById(intent._id);
        await PaymentIntent.updateOne(
            { _id: intent._id },
            { $set: { status: PAYMENT_STATUSES.CAPTURED, capturedAt: new Date() } }
        );

        const originalFindOne = PaymentIntent.findOne;
        jest.spyOn(PaymentIntent, 'findOne')
            .mockResolvedValueOnce(staleIntent)
            .mockImplementation((...args) => originalFindOne.apply(PaymentIntent, args));

        const { next } = await invoke(startEscrow, {
            user: buyer,
            listingId: listing._id,
            body: { paymentIntentId: intent.intentId },
        });

        expect(next).not.toHaveBeenCalled();
        const after = await PaymentIntent.findById(intent._id).lean();
        expect(after.status).toBe(PAYMENT_STATUSES.CAPTURED);
        const stored = await Listing.findById(listing._id).lean();
        expect(stored.escrow).toMatchObject({
            state: 'held',
            paymentIntentId: intent.intentId,
            paymentState: PAYMENT_STATUSES.CAPTURED,
        });
    });

    test('does not expire an already-captured intent on a fresh startEscrow read', async () => {
        const seller = await createTestUser({ name: 'Captured Start Seller' });
        const buyer = await createTestUser({ name: 'Captured Start Buyer' });
        const listing = await createListing({ sellerId: seller._id });
        const intent = await createEscrowIntent({
            buyerId: buyer._id,
            sellerId: seller._id,
            listingId: listing._id,
            intentId: 'intent_captured_start_1',
            status: PAYMENT_STATUSES.CAPTURED,
            expiresAt: new Date(Date.now() - 60 * 1000),
        });

        const { next } = await invoke(startEscrow, {
            user: buyer,
            listingId: listing._id,
            body: { paymentIntentId: intent.intentId },
        });

        expect(next).not.toHaveBeenCalled();
        const after = await PaymentIntent.findById(intent._id).lean();
        expect(after.status).toBe(PAYMENT_STATUSES.CAPTURED);
    });

    test('does not expire an already-captured intent when confirmEscrowDelivery reads a stale expiry', async () => {
        const seller = await createTestUser({ name: 'Stale Confirm Seller' });
        const buyer = await createTestUser({ name: 'Stale Confirm Buyer' });
        const listing = await createListing({
            sellerId: seller._id,
            overrides: {
                escrow: {
                    enabled: true,
                    state: 'held',
                    buyer: buyer._id,
                    amount: LISTING_PRICE,
                    paymentIntentId: 'intent_stale_confirm_1',
                    holdReference: 'ESC-intent_stale_confirm_1',
                    paymentState: PAYMENT_STATUSES.AUTHORIZED,
                    startedAt: new Date(),
                },
            },
        });
        const intent = await createEscrowIntent({
            buyerId: buyer._id,
            sellerId: seller._id,
            listingId: listing._id,
            intentId: 'intent_stale_confirm_1',
            status: PAYMENT_STATUSES.AUTHORIZED,
            expiresAt: new Date(Date.now() - 60 * 1000),
        });

        const staleIntent = await PaymentIntent.findById(intent._id);
        await PaymentIntent.updateOne(
            { _id: intent._id },
            { $set: { status: PAYMENT_STATUSES.CAPTURED, capturedAt: new Date() } }
        );

        const originalFindOne = PaymentIntent.findOne;
        jest.spyOn(PaymentIntent, 'findOne')
            .mockResolvedValueOnce(staleIntent)
            .mockImplementation((...args) => originalFindOne.apply(PaymentIntent, args));

        const { next } = await invoke(confirmEscrowDelivery, {
            user: buyer,
            listingId: listing._id,
        });

        expect(next).not.toHaveBeenCalled();
        const after = await PaymentIntent.findById(intent._id).lean();
        expect(after.status).toBe(PAYMENT_STATUSES.CAPTURED);
        const stored = await Listing.findById(listing._id).lean();
        expect(stored.escrow.state).toBe('released');
        expect(stored.status).toBe('sold');
    });

    test('does not expire an already-captured intent when confirmEscrowIntent reads a stale expiry', async () => {
        const seller = await createTestUser({ name: 'Stale Intent Confirm Seller' });
        const buyer = await createTestUser({ name: 'Stale Intent Confirm Buyer' });
        const listing = await createListing({ sellerId: seller._id });
        const intent = await createEscrowIntent({
            buyerId: buyer._id,
            sellerId: seller._id,
            listingId: listing._id,
            intentId: 'intent_stale_intent_confirm_1',
            status: PAYMENT_STATUSES.CREATED,
            expiresAt: new Date(Date.now() - 60 * 1000),
        });

        const staleIntent = await PaymentIntent.findById(intent._id);
        await PaymentIntent.updateOne(
            { _id: intent._id },
            { $set: { status: PAYMENT_STATUSES.CAPTURED, capturedAt: new Date() } }
        );

        const originalFindOne = PaymentIntent.findOne;
        jest.spyOn(PaymentIntent, 'findOne')
            .mockResolvedValueOnce(staleIntent)
            .mockImplementation((...args) => originalFindOne.apply(PaymentIntent, args));

        const { res, next } = await invoke(confirmEscrowIntent, {
            user: buyer,
            listingId: listing._id,
            params: { intentId: intent.intentId },
        });

        expect(next).not.toHaveBeenCalled();
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
            intentId: intent.intentId,
            status: PAYMENT_STATUSES.CAPTURED,
        }));
        const after = await PaymentIntent.findById(intent._id).lean();
        expect(after.status).toBe(PAYMENT_STATUSES.CAPTURED);
    });
});

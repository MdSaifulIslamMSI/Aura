jest.mock('../services/payments/paymentCapabilities', () => ({
    getPaymentCapabilities: jest.fn().mockResolvedValue({
        provider: 'razorpay',
        source: 'provider',
        stale: false,
        rails: {
            upi: { available: true, appCount: 2, apps: [{ code: 'gpay', name: 'Google Pay' }] },
            card: { available: true, networkCount: 3, networks: [{ code: 'visa', name: 'Visa' }] },
            wallet: { available: true, walletCount: 1, wallets: [{ code: 'paytm', name: 'Paytm Wallet' }] },
            netbanking: { available: true, bankCount: 4, featuredBanks: [{ code: 'HDFC', name: 'HDFC Bank' }] },
        },
    }),
}));

jest.mock('../services/payments/providerFactory', () => ({
    getPaymentProvider: jest.fn().mockResolvedValue({ name: 'razorpay' }),
}));

const User = require('../models/User');
const PaymentIntent = require('../models/PaymentIntent');
const PaymentEvent = require('../models/PaymentEvent');
const PaymentOutboxTask = require('../models/PaymentOutboxTask');
const { PAYMENT_STATUSES } = require('../services/payments/constants');
const { hashPayload } = require('../services/payments/helpers');
const {
    getPaymentOpsOverview,
    expireStalePaymentIntents,
} = require('../services/payments/paymentOperationsService');

const makeUser = async (overrides = {}) => User.create({
    name: 'Ops User',
    email: `ops-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`,
    phone: `+91${Math.floor(1000000000 + Math.random() * 9000000000)}`,
    isVerified: true,
    ...overrides,
});

const makeIntent = async ({
    userId,
    intentId = `pi_${Math.random().toString(36).slice(2, 10)}`,
    status = PAYMENT_STATUSES.CREATED,
    expiresAt = new Date(Date.now() + 30 * 60 * 1000),
    authorizedAt = null,
    marketCountryCode = 'IN',
    marketCurrency = 'INR',
} = {}) => PaymentIntent.create({
    intentId,
    user: userId,
    provider: 'razorpay',
    providerOrderId: `order_${Math.random().toString(36).slice(2, 10)}`,
    amount: 2499,
    currency: 'INR',
    marketCountryCode,
    marketCurrency,
    settlementCurrency: 'INR',
    method: 'CARD',
    status,
    expiresAt,
    authorizedAt,
    metadata: {},
    riskSnapshot: { score: 0, decision: 'allow', factors: [], mode: 'shadow' },
    challenge: { required: false, status: 'none', verifiedAt: null },
});

describe('Payment operations service', () => {
    test('getPaymentOpsOverview aggregates stale intents outbox backlog and webhook signals', async () => {
        const now = new Date('2026-03-27T10:00:00.000Z');
        const user = await makeUser();

        await makeIntent({
            userId: user._id,
            intentId: 'pi_expired_candidate',
            status: PAYMENT_STATUSES.CREATED,
            expiresAt: new Date('2026-03-27T09:00:00.000Z'),
        });
        await makeIntent({
            userId: user._id,
            intentId: 'pi_authorized_old',
            status: PAYMENT_STATUSES.AUTHORIZED,
            authorizedAt: new Date('2026-03-27T09:20:00.000Z'),
            expiresAt: new Date('2026-03-27T11:00:00.000Z'),
            marketCountryCode: 'US',
            marketCurrency: 'USD',
        });

        await PaymentOutboxTask.create([
            {
                taskType: 'capture',
                intentId: 'pi_authorized_old',
                payload: {},
                status: 'pending',
                retryCount: 1,
                nextRunAt: new Date('2026-03-27T09:30:00.000Z'),
            },
            {
                taskType: 'refund',
                intentId: 'pi_refund_1',
                payload: { requestId: 'refund_req_ops_1' },
                status: 'failed',
                retryCount: 2,
                nextRunAt: new Date('2026-03-27T09:45:00.000Z'),
            },
        ]);

        await PaymentEvent.create([
            {
                eventId: 'evt_webhook_1',
                intentId: 'pi_authorized_old',
                source: 'webhook',
                type: 'payment.authorized',
                payloadHash: hashPayload({ event: 'payment.authorized' }),
                payload: { event: 'payment.authorized' },
                receivedAt: new Date('2026-03-27T09:55:00.000Z'),
            },
            {
                eventId: 'evt_webhook_discarded_1',
                intentId: 'pi_authorized_old',
                source: 'webhook',
                type: 'payment.captured',
                payloadHash: hashPayload({ event: 'payment.captured' }),
                payload: {
                    event: 'payment.captured',
                    processingMeta: { discarded: true },
                },
                receivedAt: new Date('2026-03-27T09:58:00.000Z'),
            },
            {
                eventId: 'evt_confirm_fail_1',
                intentId: 'pi_authorized_old',
                source: 'api',
                type: 'intent.confirm_failed',
                payloadHash: hashPayload({ reason: 'invalid_signature' }),
                payload: { reason: 'invalid_signature' },
                receivedAt: new Date('2026-03-27T09:59:00.000Z'),
            },
        ]);

        const overview = await getPaymentOpsOverview({ referenceTime: now });

        expect(overview.attentionLevel).toBe('warning');
        expect(overview.intents.staleExpiredCandidates).toBeGreaterThanOrEqual(1);
        expect(overview.intents.authorizedNeedingAttention).toBeGreaterThanOrEqual(1);
        expect(overview.outbox.pending).toBeGreaterThanOrEqual(1);
        expect(overview.outbox.failed).toBeGreaterThanOrEqual(1);
        expect(overview.webhooks.events24h).toBeGreaterThanOrEqual(2);
        expect(overview.webhooks.discardedTransitions24h).toBeGreaterThanOrEqual(1);
        expect(overview.provider.capabilities.rails.netbanking.bankCount).toBe(4);
        expect(overview.markets.internationalIntents).toBeGreaterThanOrEqual(1);
        expect(overview.markets.topCountries).toEqual(
            expect.arrayContaining([expect.objectContaining({ countryCode: 'US' })])
        );
    });

    test('expireStalePaymentIntents marks expired candidates and records ops events', async () => {
        const now = new Date('2026-03-27T12:00:00.000Z');
        const user = await makeUser();
        const staleIntent = await makeIntent({
            userId: user._id,
            intentId: 'pi_expire_me',
            status: PAYMENT_STATUSES.CHALLENGE_PENDING,
            expiresAt: new Date('2026-03-27T11:30:00.000Z'),
        });

        const result = await expireStalePaymentIntents({
            referenceTime: now,
            limit: 20,
            dryRun: false,
        });

        expect(result).toMatchObject({
            scanned: 1,
            expiredCount: 1,
        });

        const refreshed = await PaymentIntent.findOne({ intentId: staleIntent.intentId }).lean();
        expect(refreshed.status).toBe(PAYMENT_STATUSES.EXPIRED);

        const event = await PaymentEvent.findOne({
            intentId: staleIntent.intentId,
            type: 'intent.expired_by_ops',
        }).lean();
        expect(event).toBeTruthy();
    });
});

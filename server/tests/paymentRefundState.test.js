const { PAYMENT_STATUSES } = require('../services/payments/constants');
const {
    calculateRefundable,
    buildRefundEntry,
    buildRefundMutation,
} = require('../services/payments/refundState');

describe('Payment refund state helpers', () => {
    test('calculateRefundable clamps remaining balance at zero', () => {
        expect(calculateRefundable({
            totalPrice: 3000,
            refundSummary: { totalRefunded: 1200 },
        })).toBe(1800);

        expect(calculateRefundable({
            totalPrice: 3000,
            refundSummary: { totalRefunded: 3200 },
        })).toBe(0);
    });

    test('buildRefundEntry normalizes provider response and fallback id', () => {
        const createdAt = new Date('2026-03-06T00:00:00.000Z');
        const entry = buildRefundEntry({
            providerRefund: { id: 'rfnd_123', status: 'processed' },
            requestedAmount: 999,
            reason: 'customer_request',
            fallbackRefundId: 'rfnd_fallback',
            createdAt,
        });

        expect(entry).toEqual({
            refundId: 'rfnd_123',
            amount: 999,
            reason: 'customer_request',
            status: 'processed',
            createdAt,
        });

        const fallback = buildRefundEntry({
            providerRefund: {},
            requestedAmount: 499,
            reason: '',
            fallbackRefundId: 'rfnd_fallback',
            createdAt,
        });
        expect(fallback.refundId).toBe('rfnd_fallback');
        expect(fallback.reason).toBe('requested_by_user');
        expect(fallback.status).toBe('processed');
    });

    test('buildRefundMutation computes partial and full refund transitions', () => {
        const partialEntry = {
            refundId: 'rfnd_partial',
            amount: 1000,
            reason: 'partial',
            status: 'processed',
            createdAt: new Date('2026-03-06T00:00:00.000Z'),
        };

        const partial = buildRefundMutation({
            order: {
                totalPrice: 3000,
                refundSummary: {
                    totalRefunded: 500,
                    fullyRefunded: false,
                    refunds: [{ refundId: 'old' }],
                },
            },
            requestedAmount: 1000,
            refundEntry: partialEntry,
        });

        expect(partial.nextTotalRefunded).toBe(1500);
        expect(partial.fullyRefunded).toBe(false);
        expect(partial.paymentState).toBe(PAYMENT_STATUSES.PARTIALLY_REFUNDED);
        expect(partial.refundSummary.refunds).toHaveLength(2);

        const finalEntry = {
            refundId: 'rfnd_full',
            amount: 1500,
            reason: 'full',
            status: 'processed',
            createdAt: new Date('2026-03-06T01:00:00.000Z'),
        };
        const full = buildRefundMutation({
            order: {
                totalPrice: 3000,
                refundSummary: {
                    totalRefunded: 1500,
                    fullyRefunded: false,
                    refunds: [partialEntry],
                },
            },
            requestedAmount: 1500,
            refundEntry: finalEntry,
        });

        expect(full.nextTotalRefunded).toBe(3000);
        expect(full.fullyRefunded).toBe(true);
        expect(full.paymentState).toBe(PAYMENT_STATUSES.REFUNDED);
        expect(full.refundSummary.refunds[1]).toEqual(finalEntry);
    });
});

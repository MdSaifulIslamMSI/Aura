const { PAYMENT_STATUSES } = require('../services/payments/constants');
const {
    calculateRefundable,
    calculatePresentmentRefundable,
    resolveRefundAmounts,
    buildRefundEntry,
    buildRefundMutation,
} = require('../services/payments/refundState');

describe('Payment refund state helpers', () => {
    test('calculateRefundable clamps remaining settlement and charge balances at zero', () => {
        expect(calculateRefundable({
            totalPrice: 3000,
            refundSummary: { totalRefunded: 1200 },
        })).toBe(1800);

        expect(calculatePresentmentRefundable({
            presentmentTotalPrice: 36,
            presentmentCurrency: 'USD',
            refundSummary: { presentmentTotalRefunded: 12 },
        })).toBe(24);

        expect(calculateRefundable({
            totalPrice: 3000,
            refundSummary: { totalRefunded: 3200 },
        })).toBe(0);
    });

    test('resolveRefundAmounts converts between settlement and charge currency proportionally', () => {
        const order = {
            settlementAmount: 8400,
            settlementCurrency: 'INR',
            presentmentTotalPrice: 100,
            presentmentCurrency: 'USD',
            refundSummary: {
                totalRefunded: 0,
                presentmentTotalRefunded: 0,
                refunds: [],
            },
        };

        expect(resolveRefundAmounts({
            order,
            amount: 2100,
            amountMode: 'settlement',
        })).toEqual({
            settlementCurrency: 'INR',
            presentmentCurrency: 'USD',
            remainingSettlement: 8400,
            remainingPresentment: 100,
            settlementAmount: 2100,
            presentmentAmount: 25,
        });

        expect(resolveRefundAmounts({
            order,
            amount: 25,
            amountMode: 'charge',
        })).toEqual({
            settlementCurrency: 'INR',
            presentmentCurrency: 'USD',
            remainingSettlement: 8400,
            remainingPresentment: 100,
            settlementAmount: 2100,
            presentmentAmount: 25,
        });
    });

    test('buildRefundEntry normalizes provider response and carries both currency layers', () => {
        const createdAt = new Date('2026-03-06T00:00:00.000Z');
        const entry = buildRefundEntry({
            providerRefund: { id: 'rfnd_123', status: 'processed' },
            refundAmounts: {
                settlementAmount: 2100,
                settlementCurrency: 'INR',
                presentmentAmount: 25,
                presentmentCurrency: 'USD',
            },
            reason: 'customer_request',
            fallbackRefundId: 'rfnd_fallback',
            createdAt,
        });

        expect(entry).toEqual({
            refundId: 'rfnd_123',
            amount: 25,
            currency: 'USD',
            settlementAmount: 2100,
            settlementCurrency: 'INR',
            presentmentAmount: 25,
            presentmentCurrency: 'USD',
            reason: 'customer_request',
            status: 'processed',
            createdAt,
        });
    });

    test('buildRefundMutation computes partial and full refund transitions across both ledgers', () => {
        const partialEntry = {
            refundId: 'rfnd_partial',
            amount: 25,
            currency: 'USD',
            settlementAmount: 2100,
            settlementCurrency: 'INR',
            presentmentAmount: 25,
            presentmentCurrency: 'USD',
            reason: 'partial',
            status: 'processed',
            createdAt: new Date('2026-03-06T00:00:00.000Z'),
        };

        const partial = buildRefundMutation({
            order: {
                settlementAmount: 8400,
                settlementCurrency: 'INR',
                presentmentTotalPrice: 100,
                presentmentCurrency: 'USD',
                refundSummary: {
                    totalRefunded: 0,
                    presentmentTotalRefunded: 0,
                    fullyRefunded: false,
                    refunds: [{ refundId: 'old' }],
                },
            },
            refundEntry: partialEntry,
        });

        expect(partial.nextTotalRefunded).toBe(2100);
        expect(partial.nextPresentmentTotalRefunded).toBe(25);
        expect(partial.fullyRefunded).toBe(false);
        expect(partial.paymentState).toBe(PAYMENT_STATUSES.PARTIALLY_REFUNDED);
        expect(partial.refundSummary.refunds).toHaveLength(2);

        const finalEntry = {
            refundId: 'rfnd_full',
            amount: 75,
            currency: 'USD',
            settlementAmount: 6300,
            settlementCurrency: 'INR',
            presentmentAmount: 75,
            presentmentCurrency: 'USD',
            reason: 'full',
            status: 'processed',
            createdAt: new Date('2026-03-06T01:00:00.000Z'),
        };
        const full = buildRefundMutation({
            order: {
                settlementAmount: 8400,
                settlementCurrency: 'INR',
                presentmentTotalPrice: 100,
                presentmentCurrency: 'USD',
                refundSummary: {
                    totalRefunded: 2100,
                    presentmentTotalRefunded: 25,
                    fullyRefunded: false,
                    refunds: [partialEntry],
                },
            },
            refundEntry: finalEntry,
        });

        expect(full.nextTotalRefunded).toBe(8400);
        expect(full.nextPresentmentTotalRefunded).toBe(100);
        expect(full.fullyRefunded).toBe(true);
        expect(full.paymentState).toBe(PAYMENT_STATUSES.REFUNDED);
        expect(full.refundSummary.refunds[1]).toEqual(finalEntry);
    });
});

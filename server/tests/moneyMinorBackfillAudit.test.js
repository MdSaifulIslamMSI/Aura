const {
    compareDocumentMinorFields,
    hashDocumentId,
    shouldApplyBackfill,
    summarizeCollectionAudit,
} = require('../scripts/audit_money_minor_units');

describe('money minor-unit backfill audit', () => {
    test('detects missing PaymentIntent minor-unit mirrors without exposing raw ids', () => {
        const result = compareDocumentMinorFields({
            collectionName: 'paymentintents',
            document: {
                _id: 'payment-intent-primary-key',
                amount: 1234.56,
                currency: 'INR',
                baseAmount: 1234.56,
                baseCurrency: 'INR',
                displayAmount: 15.5,
                displayCurrency: 'USD',
                settlementAmount: 1234.56,
                settlementCurrency: 'INR',
                providerBaseAmount: null,
                providerBaseCurrency: '',
            },
        });

        expect(result.documentHash).toBe(hashDocumentId('payment-intent-primary-key'));
        expect(result.documentHash).not.toContain('payment-intent-primary-key');
        expect(result.missingPaths).toEqual(expect.arrayContaining([
            'amountMinor',
            'baseAmountMinor',
            'displayAmountMinor',
            'settlementAmountMinor',
        ]));
        expect(result.mismatchedPaths).toEqual([]);
        expect(result.setFields).toMatchObject({
            amountMinor: 123456,
            baseAmountMinor: 123456,
            displayAmountMinor: 1550,
            settlementAmountMinor: 123456,
        });
    });

    test('detects mismatched Order item, total, and refund minor-unit mirrors', () => {
        const result = compareDocumentMinorFields({
            collectionName: 'orders',
            document: {
                _id: 'order-primary-key',
                orderItems: [{
                    price: 999.49,
                    priceMinor: 1,
                }],
                itemsPrice: 999.49,
                itemsPriceMinor: 1,
                taxPrice: 179.91,
                taxPriceMinor: 1,
                shippingPrice: 40,
                shippingPriceMinor: 4000,
                totalPrice: 1219.4,
                totalPriceMinor: 1,
                baseAmount: 1219.4,
                baseCurrency: 'INR',
                baseAmountMinor: 121940,
                displayAmount: 14.63,
                displayCurrency: 'USD',
                displayAmountMinor: 1463,
                settlementAmount: 1219.4,
                settlementCurrency: 'INR',
                settlementAmountMinor: 121940,
                presentmentTotalPrice: 14.63,
                presentmentCurrency: 'USD',
                presentmentTotalPriceMinor: 1463,
                couponDiscount: 10,
                couponDiscountMinor: 1000,
                paymentAdjustment: 5,
                paymentAdjustmentMinor: 500,
                refundSummary: {
                    totalRefunded: 100.25,
                    settlementCurrency: 'INR',
                    totalRefundedMinor: 1,
                    presentmentCurrency: 'USD',
                    presentmentTotalRefunded: 1.2,
                    presentmentTotalRefundedMinor: 120,
                    refunds: [{
                        amount: 1.2,
                        amountMinor: 1,
                        currency: 'USD',
                        settlementAmount: 100.25,
                        settlementAmountMinor: 10025,
                        settlementCurrency: 'INR',
                        presentmentAmount: 1.2,
                        presentmentAmountMinor: 120,
                        presentmentCurrency: 'USD',
                    }],
                },
                commandCenter: {
                    refunds: [{
                        amount: 100.25,
                        amountMinor: 1,
                    }],
                },
            },
        });

        expect(result.missingPaths).toEqual([]);
        expect(result.mismatchedPaths).toEqual(expect.arrayContaining([
            'orderItems.0.priceMinor',
            'itemsPriceMinor',
            'taxPriceMinor',
            'totalPriceMinor',
            'refundSummary.totalRefundedMinor',
            'refundSummary.refunds.0.amountMinor',
            'commandCenter.refunds.0.amountMinor',
        ]));
        expect(result.setFields).toMatchObject({
            'orderItems.0.priceMinor': 99949,
            itemsPriceMinor: 99949,
            taxPriceMinor: 17991,
            totalPriceMinor: 121940,
            'refundSummary.totalRefundedMinor': 10025,
            'refundSummary.refunds.0.amountMinor': 120,
            'commandCenter.refunds.0.amountMinor': 10025,
        });
    });

    test('summarizes findings with capped redacted samples', () => {
        const clean = {
            documentHash: hashDocumentId('clean'),
            missingPaths: [],
            mismatchedPaths: [],
        };
        const finding = {
            documentHash: hashDocumentId('finding'),
            missingPaths: ['amountMinor', 'baseAmountMinor'],
            mismatchedPaths: ['displayAmountMinor'],
        };

        const summary = summarizeCollectionAudit({
            collectionName: 'paymentintents',
            totalDocuments: 10,
            scannedDocuments: 5,
            differenceResults: [clean, finding],
            sampleLimit: 1,
            limit: 5,
        });

        expect(summary).toMatchObject({
            collection: 'paymentintents',
            totalDocuments: 10,
            scannedDocuments: 5,
            limited: true,
            documentsWithFindings: 1,
            missingMinorFieldCount: 2,
            mismatchedMinorFieldCount: 1,
        });
        expect(summary.samples).toEqual([{
            documentHash: finding.documentHash,
            missingPaths: ['amountMinor', 'baseAmountMinor'],
            mismatchedPaths: ['displayAmountMinor'],
        }]);
    });

    test('parses apply mode only when explicitly requested', () => {
        expect(shouldApplyBackfill(['--apply'])).toBe(true);
        expect(shouldApplyBackfill(['--limit=10'])).toBe(false);
    });
});

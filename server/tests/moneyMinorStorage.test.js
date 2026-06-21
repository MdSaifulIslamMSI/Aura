const mongoose = require('mongoose');
const Order = require('../models/Order');
const PaymentIntent = require('../models/PaymentIntent');

describe('minor-unit money storage', () => {
    test('PaymentIntent stores canonical integer minor-unit mirrors for decimal money fields', async () => {
        const intent = new PaymentIntent({
            intentId: 'pi_minor_units_1',
            user: new mongoose.Types.ObjectId(),
            provider: 'razorpay',
            providerOrderId: 'order_minor_units_1',
            amount: 1234.56,
            currency: 'INR',
            baseAmount: 1000.111,
            baseCurrency: 'INR',
            displayAmount: 15.5,
            displayCurrency: 'USD',
            settlementAmount: 1234.56,
            settlementCurrency: 'INR',
            providerBaseAmount: 1234.56,
            providerBaseCurrency: 'INR',
            method: 'CARD',
            expiresAt: new Date(Date.now() + 30 * 60 * 1000),
        });

        await intent.validate();

        expect(intent.amountMinor).toBe(123456);
        expect(intent.baseAmountMinor).toBe(100011);
        expect(intent.displayAmountMinor).toBe(1550);
        expect(intent.settlementAmountMinor).toBe(123456);
        expect(intent.providerBaseAmountMinor).toBe(123456);
        expect(Number.isSafeInteger(intent.amountMinor)).toBe(true);
    });

    test('PaymentIntent respects zero-decimal currency exponents', async () => {
        const intent = new PaymentIntent({
            intentId: 'pi_minor_units_jpy',
            user: new mongoose.Types.ObjectId(),
            provider: 'stripe',
            providerOrderId: 'order_minor_units_jpy',
            amount: 1234.56,
            currency: 'JPY',
            baseAmount: 1234.56,
            baseCurrency: 'JPY',
            displayAmount: 1234.56,
            displayCurrency: 'JPY',
            settlementAmount: 1234.56,
            settlementCurrency: 'JPY',
            method: 'CARD',
            expiresAt: new Date(Date.now() + 30 * 60 * 1000),
        });

        await intent.validate();

        expect(intent.amountMinor).toBe(1235);
        expect(intent.baseAmountMinor).toBe(1235);
        expect(intent.displayAmountMinor).toBe(1235);
        expect(intent.settlementAmountMinor).toBe(1235);
        expect(intent.providerBaseAmountMinor).toBeNull();
    });

    test('Order stores integer minor-unit mirrors for totals, items, refunds, and command-center refunds', async () => {
        const order = new Order({
            user: new mongoose.Types.ObjectId(),
            orderItems: [{
                title: 'Minor Unit Product',
                quantity: 1,
                image: 'https://example.com/minor-unit-product.jpg',
                price: 999.49,
                product: new mongoose.Types.ObjectId(),
            }],
            shippingAddress: {
                address: '42 Ledger Lane',
                city: 'Bengaluru',
                postalCode: '560001',
                country: 'India',
            },
            paymentMethod: 'CARD',
            itemsPrice: 999.49,
            taxPrice: 179.91,
            shippingPrice: 40,
            totalPrice: 1219.4,
            baseAmount: 1219.4,
            baseCurrency: 'INR',
            displayAmount: 14.63,
            displayCurrency: 'USD',
            settlementAmount: 1219.4,
            settlementCurrency: 'INR',
            presentmentTotalPrice: 14.63,
            presentmentCurrency: 'USD',
            couponDiscount: 10,
            paymentAdjustment: 5,
            paymentState: 'captured',
            isPaid: true,
            paidAt: new Date(),
            refundSummary: {
                totalRefunded: 100.25,
                settlementCurrency: 'INR',
                presentmentCurrency: 'USD',
                presentmentTotalRefunded: 1.2,
                fullyRefunded: false,
                refunds: [{
                    refundId: 'rfnd_minor_units_1',
                    amount: 1.2,
                    currency: 'USD',
                    settlementAmount: 100.25,
                    settlementCurrency: 'INR',
                    presentmentAmount: 1.2,
                    presentmentCurrency: 'USD',
                    status: 'processed',
                }],
            },
            commandCenter: {
                refunds: [{
                    requestId: 'rfnd-request-1',
                    amount: 100.25,
                    reason: 'minor-unit-contract',
                    status: 'processed',
                }],
            },
        });

        await order.validate();

        expect(order.orderItems[0].priceMinor).toBe(99949);
        expect(order.itemsPriceMinor).toBe(99949);
        expect(order.taxPriceMinor).toBe(17991);
        expect(order.shippingPriceMinor).toBe(4000);
        expect(order.totalPriceMinor).toBe(121940);
        expect(order.baseAmountMinor).toBe(121940);
        expect(order.displayAmountMinor).toBe(1463);
        expect(order.settlementAmountMinor).toBe(121940);
        expect(order.presentmentTotalPriceMinor).toBe(1463);
        expect(order.couponDiscountMinor).toBe(1000);
        expect(order.paymentAdjustmentMinor).toBe(500);
        expect(order.refundSummary.totalRefundedMinor).toBe(10025);
        expect(order.refundSummary.presentmentTotalRefundedMinor).toBe(120);
        expect(order.refundSummary.refunds[0].amountMinor).toBe(120);
        expect(order.refundSummary.refunds[0].settlementAmountMinor).toBe(10025);
        expect(order.refundSummary.refunds[0].presentmentAmountMinor).toBe(120);
        expect(order.commandCenter.refunds[0].amountMinor).toBe(10025);
    });
});

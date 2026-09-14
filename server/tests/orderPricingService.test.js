const AppError = require('../utils/AppError');
const {
    normalizeCheckoutPayload,
    calculatePricing,
} = require('../services/orderPricingService');

describe('Order Pricing Service', () => {
    test('normalizeCheckoutPayload supports legacy keys (qty + street + pincode/state)', () => {
        const normalized = normalizeCheckoutPayload({
            orderItems: [{ product: 10, qty: 2 }],
            shippingAddress: {
                street: '221B Baker Street',
                city: 'London',
                pincode: '10001',
                state: 'India',
            },
            paymentMethod: 'cod',
        });

        expect(normalized.orderItems[0]).toEqual({ productId: 10, quantity: 2 });
        expect(normalized.shippingAddress).toEqual({
            address: '221B Baker Street',
            city: 'London',
            postalCode: '10001',
            country: 'India',
        });
        expect(normalized.paymentMethod).toBe('COD');
        expect(normalized.deliveryOption).toBe('standard');
    });

    test('normalizeCheckoutPayload supports new keys (quantity + address + postalCode/country)', () => {
        const normalized = normalizeCheckoutPayload({
            orderItems: [{ product: '15', quantity: 3 }],
            shippingAddress: {
                address: '42 Main Road',
                city: 'Pune',
                postalCode: '411001',
                country: 'India',
            },
            paymentMethod: 'UPI',
            deliveryOption: 'express',
            deliverySlot: { date: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10), window: '12:00-15:00' },
        });

        expect(normalized.orderItems[0]).toEqual({ productId: 15, quantity: 3 });
        expect(normalized.deliveryOption).toBe('express');
        expect(normalized.deliverySlot.window).toBe('12:00-15:00');
        expect(normalized.deliverySlot.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    test('normalizeCheckoutPayload accepts NETBANKING rails from checkout clients', () => {
        const normalized = normalizeCheckoutPayload({
            orderItems: [{ product: '15', quantity: 1 }],
            shippingAddress: {
                address: '42 Main Road',
                city: 'Pune',
                postalCode: '411001',
                country: 'India',
            },
            paymentMethod: 'netbanking',
            paymentContext: {
                market: {
                    countryCode: 'US',
                    currency: 'USD',
                },
                netbanking: {
                    bankCode: 'HDFC',
                    bankName: 'HDFC Bank',
                    source: 'catalog',
                },
            },
        });

        expect(normalized.paymentMethod).toBe('NETBANKING');
        expect(normalized.paymentContext).toEqual({
            market: {
                countryCode: 'US',
                currency: 'USD',
            },
            netbanking: {
                bankCode: 'HDFC',
                bankName: 'HDFC Bank',
                source: 'catalog',
            },
        });
    });

    test('calculatePricing applies valid coupon', async () => {
        const pricing = await calculatePricing({
            resolvedItems: [{ lineTotal: 2000 }],
            deliveryOption: 'standard',
            paymentMethod: 'UPI',
            couponCode: 'AURA10',
        });

        expect(pricing.itemsPrice).toBe(2000);
        expect(pricing.couponDiscount).toBeGreaterThan(0);
        expect(pricing.appliedCoupon?.code).toBe('AURA10');
        expect(pricing.totalPrice).toBeGreaterThan(0);
    });

    test('calculatePricing rejects invalid coupon', async () => {
        await expect(calculatePricing({
            resolvedItems: [{ lineTotal: 2000 }],
            deliveryOption: 'standard',
            paymentMethod: 'COD',
            couponCode: 'INVALID',
        })).rejects.toThrow(AppError);
    });

    test('calculatePricing rejects UPI-only coupon on non-UPI method', async () => {
        await expect(calculatePricing({
            resolvedItems: [{ lineTotal: 1200 }],
            deliveryOption: 'standard',
            paymentMethod: 'COD',
            couponCode: 'UPI50',
        })).rejects.toThrow(AppError);
    });
});

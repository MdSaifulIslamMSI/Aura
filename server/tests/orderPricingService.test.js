const AppError = require('../utils/AppError');
const {
    normalizeCheckoutPayload,
    calculatePricing,
    simulatePaymentResult,
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
            deliverySlot: { date: '2026-03-01', window: '12:00-15:00' },
        });

        expect(normalized.orderItems[0]).toEqual({ productId: 15, quantity: 3 });
        expect(normalized.deliveryOption).toBe('express');
        expect(normalized.deliverySlot).toEqual({ date: '2026-03-01', window: '12:00-15:00' });
    });

    test('calculatePricing applies valid coupon', () => {
        const pricing = calculatePricing({
            itemsPrice: 2000,
            deliveryOption: 'standard',
            paymentMethod: 'UPI',
            couponCode: 'AURA10',
        });

        expect(pricing.itemsPrice).toBe(2000);
        expect(pricing.couponDiscount).toBeGreaterThan(0);
        expect(pricing.appliedCoupon?.code).toBe('AURA10');
        expect(pricing.totalPrice).toBeGreaterThan(0);
    });

    test('calculatePricing rejects invalid coupon', () => {
        expect(() => calculatePricing({
            itemsPrice: 2000,
            deliveryOption: 'standard',
            paymentMethod: 'COD',
            couponCode: 'INVALID',
        })).toThrow(AppError);
    });

    test('calculatePricing rejects UPI-only coupon on non-UPI method', () => {
        expect(() => calculatePricing({
            itemsPrice: 1200,
            deliveryOption: 'standard',
            paymentMethod: 'COD',
            couponCode: 'UPI50',
        })).toThrow(AppError);
    });

    test('simulatePaymentResult is deterministic for same input', () => {
        const payload = {
            paymentMethod: 'CARD',
            amount: 1499.99,
            attemptToken: 'attempt-123',
        };

        const first = simulatePaymentResult(payload);
        const second = simulatePaymentResult(payload);

        expect(first).toEqual(second);
        expect(['success', 'pending', 'failure']).toContain(first.status);
        expect(first.referenceId.startsWith('SIM-')).toBe(true);
    });

    test('simulatePaymentResult rejects COD simulation', () => {
        expect(() => simulatePaymentResult({
            paymentMethod: 'COD',
            amount: 500,
            attemptToken: 'token-1',
        })).toThrow(AppError);
    });
});

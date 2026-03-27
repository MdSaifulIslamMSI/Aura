import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { MarketProvider } from '@/context/MarketContext';
import OrderSummary from './OrderSummary';

const noop = vi.fn();

vi.mock('@/services/api/marketApi', () => ({
    marketApi: {
        getBrowseFxRates: vi.fn().mockResolvedValue({
            baseCurrency: 'INR',
            rates: { INR: 1, USD: 0.02 },
            stale: false,
        }),
    },
    readCachedBrowseFxRates: vi.fn(() => null),
}));

describe('OrderSummary', () => {
    it('shows the locked checkout charge currency from the backend quote', () => {
        render(
            <MarketProvider initialPreference={{ countryCode: 'US', language: 'en', currency: 'USD' }}>
                <OrderSummary
                    items={[
                        {
                            id: 1,
                            title: 'Aura Phone',
                            image: '/phone.png',
                            quantity: 1,
                            pricing: {
                                displayAmount: 699,
                                displayCurrency: 'USD',
                                originalDisplayAmount: 749,
                            },
                        },
                    ]}
                    quote={{
                        itemsPrice: 699,
                        shippingPrice: 0,
                        couponDiscount: 0,
                        paymentAdjustment: 0,
                        taxPrice: 0,
                        totalPrice: 58000,
                        baseAmount: 58000,
                        baseCurrency: 'INR',
                        displayAmount: 699,
                        displayCurrency: 'USD',
                        settlementAmount: 58000,
                        settlementCurrency: 'INR',
                    }}
                    fallbackTotals={{ itemsPrice: 699, totalPrice: 699 }}
                    chargeQuote={{
                        amount: 699,
                        currency: 'USD',
                        baseAmount: 58000,
                        baseCurrency: 'INR',
                        settlementAmount: 58000,
                        settlementCurrency: 'INR',
                    }}
                    isQuoting={false}
                    quoteError=""
                    isQuoteStale={false}
                    couponCode=""
                    onCouponCodeChange={noop}
                    onApplyCoupon={noop}
                    onRemoveCoupon={noop}
                    onRecalculate={noop}
                />
            </MarketProvider>
        );

        expect(screen.getAllByText(/\$699(?:\.00)?/).length).toBeGreaterThan(0);
        expect(screen.getByText(/Base order value remains/i)).toBeInTheDocument();
    });
});

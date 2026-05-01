import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { MarketProvider } from '@/context/MarketContext';
import StepPayment from './StepPayment';

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

const noop = vi.fn();

const paymentCapabilities = {
    provider: 'razorpay',
    rails: {
        card: {
            available: true,
            networkCount: 4,
            issuerCount: 20,
            networks: [{ name: 'Visa' }, { name: 'Mastercard' }, { name: 'RuPay' }],
        },
    },
    markets: {
        defaultCountryName: 'India',
        settlementCurrency: 'INR',
        railMatrix: {
            CARD: {
                countryMode: 'allowlist',
                countries: ['IN', 'US'],
                currencies: [{ code: 'INR', name: 'Indian Rupee' }],
                settlementCurrency: 'INR',
            },
        },
    },
};

const renderStepPayment = (overrides = {}) => {
    const props = {
        isActive: true,
        completed: false,
        paymentMethod: 'CARD',
        paymentIntent: {
            intentId: 'pay_req_test_2046',
            provider: 'razorpay',
            providerPaymentId: 'rzp_test_2046',
            providerMethod: { type: 'card', brand: 'Visa', last4: '2046' },
            status: 'created',
            riskDecision: 'allow',
        },
        paymentSession: { lastSyncedAt: '2026-05-01T05:30:00.000Z' },
        isProcessingPayment: false,
        isRefreshingPayment: false,
        paymentError: '',
        onSetActive: noop,
        onPaymentMethodChange: noop,
        onExecutePayment: noop,
        onRefreshPayment: noop,
        onRestartPayment: noop,
        onFallbackToCod: noop,
        onBack: noop,
        onContinue: noop,
        savedMethods: [],
        selectedSavedMethodId: '',
        onSelectSavedMethod: noop,
        challengeRequired: false,
        challengeVerified: false,
        onSendChallengeOtp: noop,
        onMarkChallengeComplete: noop,
        isChallengeLoading: false,
        netbankingCatalog: null,
        isNetbankingCatalogLoading: false,
        selectedNetbankingBank: null,
        onSelectNetbankingBank: noop,
        paymentCapabilities,
        paymentMethods: ['COD', 'UPI', 'CARD', 'WALLET', 'NETBANKING'],
        paymentMarket: { countryCode: 'IN', currency: 'INR' },
        onMarketCountryChange: noop,
        onMarketCurrencyChange: noop,
        chargeQuote: {
            amount: 63038,
            currency: 'INR',
            settlementAmount: 63038,
            settlementCurrency: 'INR',
        },
        marketOptions: [
            { code: 'IN', label: 'India' },
            { code: 'US', label: 'United States' },
        ],
        currencyOptions: [{ code: 'INR', name: 'Indian Rupee' }],
        ...overrides,
    };

    return render(
        <MarketProvider initialPreference={{ countryCode: 'IN', language: 'en', currency: 'INR' }} disableBrowserDetection>
            <StepPayment {...props} />
        </MarketProvider>
    );
};

describe('StepPayment', () => {
    it('blocks continuing until a digital payment is authorized', () => {
        renderStepPayment();

        expect(screen.getByRole('button', { name: /^continue$/i })).toBeDisabled();
        expect(screen.getByText(/complete secure payment before continuing/i)).toBeInTheDocument();
    });

    it('allows continuing after digital payment authorization', () => {
        renderStepPayment({
            paymentIntent: {
                intentId: 'pay_req_test_2046',
                provider: 'razorpay',
                status: 'authorized',
                riskDecision: 'allow',
            },
        });

        expect(screen.getByRole('button', { name: /^continue$/i })).toBeEnabled();
        expect(screen.queryByText(/complete secure payment before continuing/i)).not.toBeInTheDocument();
    });

    it('announces selected payment and market choices with pressed state', () => {
        renderStepPayment();

        expect(screen.getByRole('button', { name: /card.*debit/i })).toHaveAttribute('aria-pressed', 'true');
        expect(screen.getByRole('button', { name: /upi.*fast payment/i })).toHaveAttribute('aria-pressed', 'false');
        expect(screen.getByRole('button', { name: /^india$/i })).toHaveAttribute('aria-pressed', 'true');
        expect(screen.getByRole('button', { name: /^united states$/i })).toHaveAttribute('aria-pressed', 'false');
    });

    it('offers secondary rail diagnostics in a mobile-friendly details control', () => {
        renderStepPayment();

        expect(screen.getByText(/^payment details$/i)).toBeInTheDocument();
        expect(screen.getByText(/rails, request, risk/i)).toBeInTheDocument();
    });
});

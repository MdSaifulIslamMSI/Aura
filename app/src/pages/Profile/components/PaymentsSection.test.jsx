import { fireEvent, render, screen } from '@testing-library/react';
import { IntlProvider } from 'react-intl';
import { describe, expect, it, vi } from 'vitest';
import PaymentsSection from './PaymentsSection';

vi.mock('@/context/MarketContext', () => ({
    useMarket: () => ({
        t: (_key, _values, fallback) => fallback,
        formatDateTime: (value) => new Date(value).toISOString(),
        formatPrice: (value) => `Rs.${value}`,
    }),
}));

vi.mock('@/i18n/useStableIcuMessages', () => ({
    useStableIcuMessages: (translate) => translate,
}));

const method = {
    _id: 'method-1',
    type: 'card',
    brand: 'Visa',
    last4: '4242',
    provider: 'stripe',
    isDefault: false,
};

const baseProps = {
    paymentMethodsLoading: false,
    paymentMethods: [method],
    recentOrders: [],
    netbankingCatalog: { banks: [], featuredBanks: [] },
    netbankingCatalogLoading: false,
    handleAddStripeCard: vi.fn(),
    handleSaveNetbankingBank: vi.fn(),
    refreshNetbankingCatalog: vi.fn(),
    handleSetDefaultMethod: vi.fn(),
    handleDeletePaymentMethod: vi.fn(),
};

const renderSection = (props = {}) => render(
    <IntlProvider locale="en" messages={{}}>
        <PaymentsSection {...baseProps} {...props} />
    </IntlProvider>
);

describe('PaymentsSection removal confirmation', () => {
    it('asks for confirmation before deleting, then deletes on the second click', () => {
        const handleDeletePaymentMethod = vi.fn();
        renderSection({ handleDeletePaymentMethod });

        const removeButton = screen.getByRole('button', { name: 'Remove' });
        fireEvent.click(removeButton);

        expect(handleDeletePaymentMethod).not.toHaveBeenCalled();
        expect(screen.getByRole('button', { name: 'Click again to confirm' })).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: 'Click again to confirm' }));
        expect(handleDeletePaymentMethod).toHaveBeenCalledWith('method-1');
    });

    it('announces the pending confirmation politely', () => {
        renderSection();

        fireEvent.click(screen.getByRole('button', { name: 'Remove' }));

        expect(screen.getByRole('button', { name: 'Click again to confirm' }))
            .toHaveAttribute('aria-live', 'polite');
    });
});

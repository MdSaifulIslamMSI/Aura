import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { MarketProvider } from '@/context/MarketContext';
import { LocaleProvider } from '@/i18n/LocaleProvider';
import StepDelivery from './StepDelivery';

const noop = vi.fn();

const renderStepDelivery = (overrides = {}) => {
    const props = {
        isActive: true,
        completed: false,
        deliveryOption: 'standard',
        deliverySlot: { date: '', window: '' },
        optimizedSlots: [{ window: '12:00-15:00', label: 'Low congestion' }],
        shippingOptions: [],
        deliveryError: '',
        onSetActive: noop,
        onDeliveryOptionChange: noop,
        onDeliverySlotChange: noop,
        onBack: noop,
        onContinue: noop,
        ...overrides,
    };

    return render(
        <MarketProvider initialPreference={{ countryCode: 'IN', language: 'en', currency: 'INR' }} disableBrowserDetection>
            <LocaleProvider>
                <StepDelivery {...props} />
            </LocaleProvider>
        </MarketProvider>
    );
};

describe('StepDelivery', () => {
    it('renders reviewed ICU delivery labels and actions', () => {
        renderStepDelivery();

        expect(screen.getByRole('button', { name: /2\. delivery slot/i })).toBeInTheDocument();
        expect(screen.getByText('Delivery Date')).toBeInTheDocument();
        expect(screen.getByText('Delivery Window')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Delivery Window' })).toHaveTextContent('Select slot');
        expect(screen.getByRole('button', { name: 'Back' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Continue' })).toBeInTheDocument();
    });

    it('reports selected delivery slot changes', () => {
        const onDeliverySlotChange = vi.fn();
        renderStepDelivery({ onDeliverySlotChange });

        fireEvent.change(screen.getByLabelText('Delivery Date'), { target: { value: '2026-06-05' } });
        fireEvent.click(screen.getByRole('button', { name: 'Delivery Window' }));
        fireEvent.click(screen.getByRole('option', { name: '12:00-15:00 (Low congestion)' }));

        expect(onDeliverySlotChange).toHaveBeenCalledWith('date', '2026-06-05');
        expect(onDeliverySlotChange).toHaveBeenCalledWith('window', '12:00-15:00');
    });

    it('renders the delivery promise when the PIN code is serviceable', () => {
        renderStepDelivery({
            serviceabilityStatus: 'ready',
            serviceability: {
                serviceable: true,
                estimateText: 'Estimated delivery in 2 days',
                zone: 'metro',
                promisedDate: '2026-09-25T12:00:00.000Z',
            },
        });

        expect(screen.getByText('Delivery promise')).toBeInTheDocument();
        expect(screen.getByText(/Estimated delivery in 2 days/)).toBeInTheDocument();
        expect(screen.getByText(/metro/)).toBeInTheDocument();
        expect(screen.getByText('Promised by')).toBeInTheDocument();
    });

    it('renders an unavailable alert when the PIN code is not serviceable', () => {
        renderStepDelivery({
            serviceabilityStatus: 'ready',
            serviceability: { serviceable: false },
        });

        expect(screen.getByText('Delivery is not available for this PIN code yet.')).toBeInTheDocument();
        expect(screen.queryByText('Delivery promise')).not.toBeInTheDocument();
    });

    it('announces the availability check while it is running', () => {
        renderStepDelivery({ serviceabilityStatus: 'checking' });

        expect(screen.getByRole('status')).toHaveTextContent(/Checking delivery availability/i);
    });

    it('renders no serviceability surface while idle', () => {
        renderStepDelivery();

        expect(screen.queryByText('Delivery promise')).not.toBeInTheDocument();
        expect(screen.queryByRole('status')).not.toBeInTheDocument();
    });
});

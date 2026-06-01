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
});

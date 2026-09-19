import { render, screen } from '@testing-library/react';
import { IntlProvider } from 'react-intl';
import { describe, expect, it } from 'vitest';
import { MarketProvider } from '@/context/MarketContext';
import { LocaleProvider } from '@/i18n/LocaleProvider';
import OrderProgressStepper from './OrderProgressStepper';

const renderStepper = (orderMeta) => render(
    <MarketProvider initialPreference={{ countryCode: 'IN', language: 'en', currency: 'INR' }} disableBrowserDetection>
        <LocaleProvider>
            <IntlProvider locale="en">
                <OrderProgressStepper orderMeta={orderMeta} />
            </IntlProvider>
        </LocaleProvider>
    </MarketProvider>
);

describe('OrderProgressStepper', () => {
    it('renders the cancelled badge instead of stages for cancelled orders', () => {
        renderStepper({ orderStatus: 'cancelled', shipments: [{ status: 'shipped' }] });

        expect(screen.getByText('Cancelled')).toBeInTheDocument();
        expect(screen.queryByText('Shipped')).not.toBeInTheDocument();
    });

    it('renders all five flow stages for a fresh order', () => {
        renderStepper({ orderStatus: 'placed' });

        expect(screen.getByText('Order confirmed')).toBeInTheDocument();
        expect(screen.getByText('Packed')).toBeInTheDocument();
        expect(screen.getByText('Shipped')).toBeInTheDocument();
        expect(screen.getByText('Out for Delivery')).toBeInTheDocument();
        expect(screen.getByText('Delivered')).toBeInTheDocument();
    });

    it('surfaces the latest checkpoint message with courier and tracking id', () => {
        renderStepper({
            orderStatus: 'shipped',
            shipments: [{
                status: 'shipped',
                courier: 'Aura Express',
                trackingId: 'AEX-123',
                checkpoints: [{ status: 'shipped', message: 'Left the hub' }],
            }],
        });

        expect(screen.getByText(/Left the hub · Aura Express · AEX-123/)).toBeInTheDocument();
    });

    it('falls back to a generic line when the checkpoint has no message', () => {
        renderStepper({
            orderStatus: 'shipped',
            shipments: [{
                status: 'shipped',
                checkpoints: [{ status: 'shipped' }],
            }],
        });

        expect(screen.getByText('Latest update received')).toBeInTheDocument();
    });
});

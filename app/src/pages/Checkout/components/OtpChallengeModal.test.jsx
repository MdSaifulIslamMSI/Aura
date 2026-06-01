import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { MarketProvider } from '@/context/MarketContext';
import { LocaleProvider } from '@/i18n/LocaleProvider';
import OtpChallengeModal from './OtpChallengeModal';

const renderOtpModal = (props = {}) => render(
    <MarketProvider initialPreference={{ countryCode: 'IN', language: 'en', currency: 'INR' }} disableBrowserDetection>
        <LocaleProvider>
            <OtpChallengeModal
                open
                loading={false}
                error=""
                onSubmit={vi.fn()}
                onClose={vi.fn()}
                {...props}
            />
        </LocaleProvider>
    </MarketProvider>
);

describe('OtpChallengeModal', () => {
    it('renders reviewed ICU payment challenge labels', () => {
        renderOtpModal();

        expect(screen.getByRole('heading', { name: 'Payment Challenge' })).toBeInTheDocument();
        expect(screen.getByLabelText('OTP digit 1')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Verify OTP' })).toBeDisabled();
        expect(screen.getByRole('button', { name: 'Cancel and retry' })).toBeInTheDocument();
    });

    it('submits the completed OTP value', () => {
        const onSubmit = vi.fn();
        renderOtpModal({ onSubmit });

        screen.getAllByRole('textbox').forEach((input, index) => {
            fireEvent.change(input, { target: { value: String(index + 1) } });
        });
        fireEvent.click(screen.getByRole('button', { name: 'Verify OTP' }));

        expect(onSubmit).toHaveBeenCalledWith('123456');
    });
});

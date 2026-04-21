import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import SettingsSection from './SettingsSection';

vi.mock('@/context/MarketContext', () => ({
    useMarket: () => ({
        t: (_key, _values, fallback) => fallback,
    }),
}));

const baseProps = {
    handleSecureRecovery: vi.fn(),
    recoveryLaunching: false,
    canStartSecureRecovery: true,
    hasOtpReadyIdentity: true,
    trustHealthy: true,
    trustLoading: false,
    paymentMethodsSecured: true,
    paymentMethodCount: 1,
    trustStatus: {
        backend: {
            timestamp: '2026-04-21T00:00:00.000Z',
            status: 'healthy',
            db: 'connected',
        },
    },
    logout: vi.fn(),
    memberSince: 'April 2026',
};

const renderSettings = (props = {}) => render(
    <MemoryRouter>
        <SettingsSection {...baseProps} {...props} />
    </MemoryRouter>,
);

describe('SettingsSection recovery codes', () => {
    it('prompts passkey users to generate backup recovery codes', () => {
        const handleGenerateRecoveryCodes = vi.fn();

        renderSettings({
            hasPasskey: true,
            shouldEnrollRecoveryCodes: true,
            passkeyRecoveryReady: false,
            recoveryCodesActiveCount: 0,
            handleGenerateRecoveryCodes,
        });

        expect(screen.getByText('Passkey backup recovery codes')).toBeInTheDocument();
        expect(screen.getByText('Recovery action')).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: /generate codes/i }));

        expect(handleGenerateRecoveryCodes).toHaveBeenCalledTimes(1);
    });

    it('keeps backup recovery code actions explicit while codes are visible once', () => {
        const handleCopyRecoveryCodes = vi.fn();
        const handleDownloadRecoveryCodes = vi.fn();
        const handleClearVisibleRecoveryCodes = vi.fn();

        renderSettings({
            hasPasskey: true,
            passkeyRecoveryReady: true,
            recoveryCodesActiveCount: 2,
            recoveryCodes: ['ABCD-EFGH-IJKL-MNOP', 'QRST-UVWX-YZ12-3456'],
            handleGenerateRecoveryCodes: vi.fn(),
            handleCopyRecoveryCodes,
            handleDownloadRecoveryCodes,
            handleClearVisibleRecoveryCodes,
        });

        expect(screen.getByText('Shown once')).toBeInTheDocument();
        expect(screen.getByText('ABCD-EFGH-IJKL-MNOP')).toBeInTheDocument();
        expect(screen.getByText('QRST-UVWX-YZ12-3456')).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: /copy/i }));
        fireEvent.click(screen.getByRole('button', { name: /download/i }));
        fireEvent.click(screen.getByRole('button', { name: /hide/i }));

        expect(handleCopyRecoveryCodes).toHaveBeenCalledTimes(1);
        expect(handleDownloadRecoveryCodes).toHaveBeenCalledTimes(1);
        expect(handleClearVisibleRecoveryCodes).toHaveBeenCalledTimes(1);
    });

    it('does not allow recovery-code generation before passkey enrollment', () => {
        const handleGenerateRecoveryCodes = vi.fn();

        renderSettings({
            hasPasskey: false,
            handleGenerateRecoveryCodes,
        });

        const generateButton = screen.getByRole('button', { name: /generate codes/i });
        expect(generateButton).toBeDisabled();

        fireEvent.click(generateButton);

        expect(handleGenerateRecoveryCodes).not.toHaveBeenCalled();
    });
});

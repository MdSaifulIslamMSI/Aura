import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import SettingsSection from './SettingsSection';

vi.mock('@/context/MarketContext', () => ({
    useOptionalMarket: () => ({
        t: (_key, _values, fallback) => fallback,
    }),
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

        expect(screen.getByText('Recovery action')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /generate codes/i })).toBeEnabled();

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

    it('does not allow recovery-code generation before MFA enrollment', () => {
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

    it('renders MFA factor status and starts passkey registration', () => {
        const handleRegisterMfaPasskey = vi.fn();

        renderSettings({
            mfaStatus: {
                enabled: true,
                methods: {
                    passkey: { enabled: true, count: 1 },
                    totp: { enabled: true },
                    recoveryCodes: { activeCount: 3 },
                },
            },
            mfaFlags: {
                enabled: true,
                passkeyEnabled: true,
                totpEnabled: true,
            },
            handleRegisterMfaPasskey,
        });

        expect(screen.getByText('Multi-factor security center')).toBeInTheDocument();
        expect(screen.getByText('MFA ready')).toBeInTheDocument();
        expect(screen.getByText('1 passkeys | 1 authenticator apps')).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: /register passkey/i }));

        expect(handleRegisterMfaPasskey).toHaveBeenCalledTimes(1);
    });

    it('keeps TOTP setup explicit while the QR payload is visible', () => {
        const setTotpSetupCode = vi.fn();
        const handleVerifyTotpSetup = vi.fn();

        renderSettings({
            mfaFlags: {
                enabled: true,
                passkeyEnabled: true,
                totpEnabled: true,
            },
            totpSetup: {
                manualKey: 'JBSWY3DPEHPK3PXP',
                qrCodeDataUrl: 'data:image/png;base64,qr',
            },
            totpSetupCode: '123456',
            setTotpSetupCode,
            handleVerifyTotpSetup,
        });

        expect(screen.getByAltText('Authenticator setup QR code')).toBeInTheDocument();
        expect(screen.getByText('Authenticator pending')).toBeInTheDocument();
        expect(screen.getByText('JBSWY3DPEHPK3PXP')).toBeInTheDocument();

        fireEvent.change(screen.getByLabelText('Authenticator code'), {
            target: { value: '654321' },
        });
        fireEvent.click(screen.getByRole('button', { name: /verify app/i }));

        expect(setTotpSetupCode).toHaveBeenCalledWith('654321');
        expect(handleVerifyTotpSetup).toHaveBeenCalledTimes(1);
    });

    it('separates remembered-browser recognition from passkey MFA and manages devices explicitly', async () => {
        const handleRenameTrustedDevice = vi.fn().mockResolvedValue({ success: true });
        const handleRevokeTrustedDevice = vi.fn().mockResolvedValue({ success: true });
        const handleRevokeOtherTrustedDevices = vi.fn().mockResolvedValue({ success: true });

        renderSettings({
            mfaStatus: {
                enabled: true,
                methods: {
                    passkey: { enabled: true, count: 1 },
                    totp: { enabled: false },
                    recoveryCodes: { activeCount: 2 },
                },
                devicePolicy: { audience: 'public', currentDeviceBound: true },
                trustedDevices: [
                    {
                        deviceId: 'device-current',
                        label: 'Home browser',
                        method: 'browser_key',
                        status: 'active',
                        active: true,
                        isCurrent: true,
                        isMfaFactor: false,
                        canRename: true,
                        canRevoke: true,
                        lastVerifiedAt: '2026-07-17T10:00:00.000Z',
                    },
                    {
                        deviceId: 'device-passkey',
                        label: 'Work laptop',
                        method: 'webauthn',
                        status: 'active',
                        active: true,
                        isCurrent: false,
                        isMfaFactor: true,
                        backedUp: true,
                        backupEligible: true,
                        canRename: true,
                        canRevoke: true,
                        lastVerifiedAt: '2026-07-16T10:00:00.000Z',
                    },
                ],
            },
            handleRenameTrustedDevice,
            handleRevokeTrustedDevice,
            handleRevokeOtherTrustedDevices,
        });

        expect(screen.getByText(/remembered browser can reduce recognition prompts, but it is not MFA/i)).toBeInTheDocument();
        expect(screen.getByText('Remembered browser · not MFA')).toBeInTheDocument();
        expect(screen.getByText('Synced passkey')).toBeInTheDocument();
        expect(screen.getByText('Current')).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: 'Rename Work laptop' }));
        fireEvent.change(screen.getByRole('textbox', { name: 'Name for Work laptop' }), {
            target: { value: 'Office security key' },
        });
        fireEvent.click(screen.getByRole('button', { name: 'Save' }));
        await waitFor(() => {
            expect(handleRenameTrustedDevice).toHaveBeenCalledWith('device-passkey', 'Office security key');
        });

        fireEvent.click(screen.getByRole('button', { name: 'Revoke Work laptop' }));
        expect(handleRevokeTrustedDevice).not.toHaveBeenCalled();
        fireEvent.click(screen.getByRole('button', { name: 'Confirm revoke Work laptop' }));
        await waitFor(() => {
            expect(handleRevokeTrustedDevice).toHaveBeenCalledWith('device-passkey', { isCurrent: false });
        });
    });

    it('shows the stricter admin device policy and legacy credential warning', () => {
        renderSettings({
            mfaStatus: {
                enabled: true,
                methods: {
                    passkey: { enabled: true, count: 1 },
                    totp: { enabled: false },
                    recoveryCodes: { activeCount: 2 },
                },
                devicePolicy: { audience: 'admin', currentDeviceBound: true },
                trustedDevices: [{
                    deviceId: 'legacy-admin-passkey',
                    label: 'Previous admin key',
                    method: 'webauthn',
                    status: 'active',
                    active: true,
                    isCurrent: true,
                    isMfaFactor: true,
                    adminEligibility: 'legacy_candidate',
                    canRename: true,
                    canRevoke: true,
                }],
            },
            handleRenameTrustedDevice: vi.fn(),
            handleRevokeTrustedDevice: vi.fn(),
        });

        expect(screen.getByText(/Admin access accepts only verified, user-verified passkeys/i)).toBeInTheDocument();
        expect(screen.getByText(/Keep at least one independent admin passkey/i)).toBeInTheDocument();
        expect(screen.getByText(/Fresh passkey verification is required before this credential can protect admin actions/i)).toBeInTheDocument();
    });

    it('offers Microsoft linking when the provider is enabled and not linked', () => {
        const handleLinkMicrosoftProvider = vi.fn();

        renderSettings({
            linkedProviderIds: ['password'],
            socialAuthStatus: { microsoftEnabled: true, appleEnabled: false },
            handleLinkMicrosoftProvider,
        });

        fireEvent.click(screen.getByRole('button', { name: /link microsoft/i }));

        expect(handleLinkMicrosoftProvider).toHaveBeenCalledTimes(1);
        expect(screen.queryByRole('button', { name: /link apple/i })).not.toBeInTheDocument();
    });

    it('marks Microsoft as linked when Firebase already has the provider', () => {
        renderSettings({
            linkedProviderIds: ['password', 'microsoft.com'],
            socialAuthStatus: { microsoftEnabled: true, appleEnabled: false },
            handleLinkMicrosoftProvider: vi.fn(),
        });

        expect(screen.getByRole('button', { name: /microsoft linked/i })).toBeDisabled();
    });
});

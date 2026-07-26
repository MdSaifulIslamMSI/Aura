import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const getAdminSecurityStatus = vi.fn();
const exchangeAdminRecoveryGrant = vi.fn();
const enrollAdminRecoveryPasskey = vi.fn();
const verifyAdminPasskey = vi.fn();

vi.mock('@/services/api/authApi', () => ({
    authApi: {
        getAdminSecurityStatus,
        exchangeAdminRecoveryGrant,
        enrollAdminRecoveryPasskey,
        verifyAdminPasskey,
    },
    getDuoStepUpUrl: vi.fn(() => '/api/auth/duo/step-up?returnTo=%2Fadmin'),
}));

let AdminSecurityCheckpoint;
let shouldUseAdminSecurityCheckpoint;

beforeAll(async () => {
    vi.stubEnv('VITE_ADMIN_SECURITY_STATE_ENGINE_V2', 'true');
    ({
        AdminSecurityCheckpoint,
        shouldUseAdminSecurityCheckpoint,
    } = await import('./AdminSecurityCheckpoint'));
});

beforeEach(() => {
    vi.clearAllMocks();
});

const renderCheckpoint = (auth = {}) => render(
    <MemoryRouter initialEntries={['/admin/dashboard']}>
        <AdminSecurityCheckpoint
            auth={{
                currentUser: { uid: 'admin-1', getIdToken: vi.fn() },
                logout: vi.fn().mockResolvedValue(undefined),
                ...auth,
            }}
        >
            <div>Admin console content</div>
        </AdminSecurityCheckpoint>
    </MemoryRouter>
);

describe('AdminSecurityCheckpoint', () => {
    it('owns only an authenticated admin MFA checkpoint on an admin route', () => {
        const subject = {
            pathname: '/admin/dashboard',
            status: 'mfa_challenge_required',
            currentUser: { uid: 'admin-1' },
            roles: { isAdmin: true },
        };

        expect(shouldUseAdminSecurityCheckpoint(subject)).toBe(true);
        expect(shouldUseAdminSecurityCheckpoint({
            ...subject,
            status: 'device_challenge_required',
        })).toBe(false);
        expect(shouldUseAdminSecurityCheckpoint({
            ...subject,
            pathname: '/checkout',
        })).toBe(false);
        expect(shouldUseAdminSecurityCheckpoint({
            ...subject,
            roles: { isAdmin: false },
        })).toBe(false);
    });

    it('uses explicit server admin challenge metadata while role state is still resolving', () => {
        const subject = {
            pathname: '/admin/dashboard',
            status: 'mfa_challenge_required',
            currentUser: { uid: 'admin-1' },
            roles: { isAdmin: false },
            mfaChallenge: {
                challengeId: 'admin-login-challenge',
                audience: 'admin',
                requiredAssurance: 'admin_passkey',
            },
        };

        expect(shouldUseAdminSecurityCheckpoint(subject)).toBe(true);
        expect(shouldUseAdminSecurityCheckpoint({
            ...subject,
            mfaChallenge: {
                challengeId: 'checkout-challenge',
                audience: 'public',
                surface: 'checkout',
            },
        })).toBe(false);
    });

    it('exchanges a recovery grant without browser persistence and advances to enrollment', async () => {
        getAdminSecurityStatus
            .mockResolvedValueOnce({
                enabled: true,
                state: 'ADMIN_RECOVERY_REQUIRED',
                actions: { canExchangeRecoveryGrant: true },
                requestId: 'request-1',
            })
            .mockResolvedValueOnce({
                enabled: true,
                state: 'ADMIN_ENROLLMENT_REQUIRED',
                actions: { canEnrollPasskey: true },
                requestId: 'request-2',
            });
        exchangeAdminRecoveryGrant.mockResolvedValue({ success: true });

        renderCheckpoint();
        const input = await screen.findByLabelText(/one-time recovery grant/i);
        const token = 'operator-issued-grant-value-abcdefghijklmnopqrstuvwxyz';
        fireEvent.change(input, { target: { value: token } });
        fireEvent.click(screen.getByRole('button', { name: /continue to passkey setup/i }));

        await waitFor(() => {
            expect(exchangeAdminRecoveryGrant).toHaveBeenCalledWith(token, expect.any(Object));
        });
        expect(window.localStorage.length).toBe(0);
        expect(await screen.findByRole('button', { name: /set up admin passkey/i })).toBeInTheDocument();
    });

    it('keeps admin content hidden when the passkey prompt is cancelled', async () => {
        getAdminSecurityStatus.mockResolvedValue({
            enabled: true,
            state: 'ADMIN_CHALLENGE_REQUIRED',
            actions: {
                canChallengePasskey: true,
                canUseDuo: false,
                canExchangeRecoveryGrant: false,
            },
            requestId: 'request-3',
        });
        const cancellation = new Error('cancelled');
        cancellation.name = 'NotAllowedError';
        verifyAdminPasskey.mockRejectedValue(cancellation);

        renderCheckpoint();
        fireEvent.click(await screen.findByRole('button', { name: /verify with passkey/i }));

        expect(await screen.findByRole('alert')).toHaveTextContent(/cancelled, timed out/i);
        expect(screen.queryByText('Admin console content')).not.toBeInTheDocument();
    });

    it('offers supervised recovery when the registered admin passkey cannot verify this browser', async () => {
        getAdminSecurityStatus.mockResolvedValue({
            enabled: true,
            state: 'ADMIN_CHALLENGE_REQUIRED',
            actions: {
                canChallengePasskey: true,
                canUseDuo: false,
                canExchangeRecoveryGrant: true,
            },
            requestId: 'request-4',
        });
        exchangeAdminRecoveryGrant.mockResolvedValue({ success: true });

        renderCheckpoint();
        const input = await screen.findByLabelText(/one-time recovery grant/i);
        const token = 'operator-issued-grant-value-abcdefghijklmnopqrstuvwxyz';
        fireEvent.change(input, { target: { value: token } });
        fireEvent.click(screen.getByRole('button', { name: /continue to passkey setup/i }));

        await waitFor(() => {
            expect(exchangeAdminRecoveryGrant).toHaveBeenCalledWith(token, expect.any(Object));
        });
        expect(window.localStorage.length).toBe(0);
        expect(screen.queryByText('Admin console content')).not.toBeInTheDocument();
    });

    it('renders admin content only after the backend reports ADMIN_VERIFIED', async () => {
        getAdminSecurityStatus.mockResolvedValue({
            enabled: true,
            state: 'ADMIN_VERIFIED',
            actions: { allowAdminAccess: true },
        });

        renderCheckpoint();

        expect(await screen.findByText('Admin console content')).toBeInTheDocument();
    });

    it('fails closed when the frontend flag is enabled before the backend state engine', async () => {
        getAdminSecurityStatus.mockResolvedValue({
            enabled: false,
            state: 'ADMIN_VERIFIED',
            actions: { allowAdminAccess: true },
        });

        renderCheckpoint();

        expect(await screen.findByText(/admin security configuration is incomplete/i)).toBeInTheDocument();
        expect(screen.queryByText('Admin console content')).not.toBeInTheDocument();
    });
});

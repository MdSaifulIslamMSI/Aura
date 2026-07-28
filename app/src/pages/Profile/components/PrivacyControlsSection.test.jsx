import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import PrivacyControlsSection from './PrivacyControlsSection';
import { authApi } from '@/services/api';

vi.mock('@/context/MarketContext', () => ({
    useMarket: () => ({
        t: (_key, _values, fallback) => fallback,
    }),
}));

vi.mock('@/i18n/useStableIcuMessages', () => ({
    useStableIcuMessages: (translate) => translate,
}));

vi.mock('@/services/api', () => ({
    authApi: {
        getAccountPrivacyCapabilities: vi.fn(),
        requestAccountExport: vi.fn(),
        requestAccountDeactivation: vi.fn(),
        requestAccountDeletion: vi.fn(),
        cancelAccountDeactivation: vi.fn(),
        cancelAccountDeletion: vi.fn(),
    },
}));

describe('PrivacyControlsSection', () => {
    const firebaseUser = { uid: 'owner-1' };

    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('shows the authoritative policy block and disables every lifecycle mutation', async () => {
        authApi.getAccountPrivacyCapabilities.mockResolvedValue({
            enabled: false,
            policyApproved: false,
            blockedReason: 'authoritative_policy_or_runtime_contract_incomplete',
            capabilities: {
                export: false,
                deactivation: false,
                deletion: false,
            },
        });

        render(<PrivacyControlsSection firebaseUser={firebaseUser} />);

        expect(await screen.findByText(/production activation is policy-blocked/i)).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Request export' })).toBeDisabled();
        expect(screen.getByRole('button', { name: 'Begin deactivation' })).toBeDisabled();
        expect(screen.getByRole('button', { name: 'Begin deletion request' })).toBeDisabled();
        expect(authApi.requestAccountDeletion).not.toHaveBeenCalled();
    });

    it('requires exact deletion confirmation and supports cancellation', async () => {
        authApi.getAccountPrivacyCapabilities.mockResolvedValue({
            enabled: true,
            policyApproved: true,
            policyVersion: 'policy-2026-07',
        });
        authApi.requestAccountDeletion.mockResolvedValue({
            request: {
                id: '507f1f77bcf86cd799439299',
                type: 'deletion',
                status: 'awaiting_grace',
            },
        });
        authApi.cancelAccountDeletion.mockResolvedValue({
            request: {
                id: '507f1f77bcf86cd799439299',
                type: 'deletion',
                status: 'cancelled',
            },
        });

        render(<PrivacyControlsSection firebaseUser={firebaseUser} />);
        const deletionAction = await screen.findByRole('button', { name: 'Begin deletion request' });
        expect(deletionAction).toBeDisabled();

        fireEvent.change(screen.getByLabelText('Type DELETE MY ACCOUNT to continue'), {
            target: { value: 'DELETE MY ACCOUNT' },
        });
        expect(deletionAction).toBeEnabled();
        fireEvent.click(deletionAction);

        await waitFor(() => {
            expect(authApi.requestAccountDeletion).toHaveBeenCalledWith(
                expect.objectContaining({
                    confirmation: 'DELETE MY ACCOUNT',
                    idempotencyKey: expect.stringMatching(/^deletion-/),
                }),
                { firebaseUser }
            );
        });
        fireEvent.click(await screen.findByRole('button', { name: 'Cancel request' }));
        await waitFor(() => {
            expect(authApi.cancelAccountDeletion).toHaveBeenCalledWith(
                { requestId: '507f1f77bcf86cd799439299' },
                { firebaseUser }
            );
        });
    });
});

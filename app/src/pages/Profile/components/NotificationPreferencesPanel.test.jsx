import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import NotificationPreferencesPanel from './NotificationPreferencesPanel';
import { userApi } from '@/services/api';

vi.mock('@/context/MarketContext', () => ({
    useMarket: () => ({
        t: (_key, _values, fallback) => fallback,
    }),
}));

vi.mock('@/i18n/useStableIcuMessages', () => ({
    useStableIcuMessages: (translate) => translate,
}));

vi.mock('@/services/api', () => ({
    userApi: {
        getAccountPreferences: vi.fn(),
        updateAccountPreferences: vi.fn(),
    },
}));

const preferences = {
    schemaVersion: 1,
    version: 2,
    notifications: {
        orderUpdates: { email: true, sms: false, push: true },
        deliveryUpdates: { email: true, sms: false, push: true },
        returnRefundUpdates: { email: true, sms: false, push: true },
        marketplaceUpdates: { email: true, sms: false, push: true },
        productAlerts: { email: false, sms: false, push: true },
        marketing: { email: false, sms: false, push: false },
        security: { email: true, sms: true, push: true, mandatory: true },
    },
};

describe('NotificationPreferencesPanel', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        userApi.getAccountPreferences.mockResolvedValue(preferences);
        userApi.updateAccountPreferences.mockResolvedValue({
            ...preferences,
            version: 3,
            notifications: {
                ...preferences.notifications,
                marketing: {
                    ...preferences.notifications.marketing,
                    email: true,
                },
            },
        });
    });

    it('loads persisted choices, labels switches, and keeps security channels mandatory', async () => {
        render(<NotificationPreferencesPanel />);

        expect(await screen.findByText('Marketing')).toBeInTheDocument();
        expect(screen.getAllByRole('switch', { name: 'email' })).toHaveLength(7);
        const securitySwitches = screen.getAllByRole('switch').slice(-3);
        securitySwitches.forEach((control) => {
            expect(control).toBeDisabled();
            expect(control).toHaveAttribute('aria-checked', 'true');
        });
    });

    it('persists an optional consent change with the current revision', async () => {
        render(<NotificationPreferencesPanel />);
        await screen.findByText('Marketing');

        fireEvent.click(screen.getAllByRole('switch', { name: 'email' })[5]);

        await waitFor(() => {
            expect(userApi.updateAccountPreferences).toHaveBeenCalledWith({
                version: 2,
                notifications: {
                    marketing: {
                        email: true,
                    },
                },
            });
        });
        expect(await screen.findByRole('status')).toHaveTextContent('Notification preference saved.');
    });
});

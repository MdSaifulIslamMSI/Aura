import { act, render, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./AuthContext', () => ({
    useAuth: () => ({ isAuthenticated: true }),
}));

vi.mock('./SocketContext', () => ({
    useSocket: () => ({ socket: null }),
}));

vi.mock('./MarketContext', () => ({
    useMarket: () => ({
        language: 'en',
        t: (_key, _params, fallback) => fallback || '',
    }),
}));

vi.mock('../services/runtimeTranslation', () => ({
    normalizeRuntimeTranslationText: (value) => value,
    requestRuntimeTranslations: vi.fn().mockResolvedValue({}),
}));

vi.mock('@/services/api', async (importOriginal) => {
    const actual = await importOriginal();
    return {
        ...actual,
        notificationApi: {
            ...actual.notificationApi,
            getNotifications: vi.fn(),
            markAsRead: vi.fn(),
            markAllAsRead: vi.fn(),
        },
    };
});

import { notificationApi } from '@/services/api';
import { NotificationProvider } from './NotificationContext';
import { useNotificationStore } from '../store/notificationStore';

describe('NotificationProvider', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        useNotificationStore.getState().reset();
        notificationApi.getNotifications.mockResolvedValue({
            data: [],
            unreadCount: 0,
        });
    });

    it('refreshes notifications when the app regains focus', async () => {
        render(
            <NotificationProvider>
                <div>Notifications ready</div>
            </NotificationProvider>
        );

        await waitFor(() => {
            expect(notificationApi.getNotifications).toHaveBeenCalledTimes(1);
        });

        await act(async () => {
            window.dispatchEvent(new Event('focus'));
        });

        await waitFor(() => {
            expect(notificationApi.getNotifications).toHaveBeenCalledTimes(2);
        });
    });
});

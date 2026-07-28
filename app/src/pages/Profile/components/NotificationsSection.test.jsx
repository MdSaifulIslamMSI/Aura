import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import NotificationsSection from './NotificationsSection';

const navigate = vi.fn();
const fetchNotifications = vi.fn();
const markAsRead = vi.fn().mockResolvedValue(undefined);

vi.mock('react-router-dom', () => ({
    useNavigate: () => navigate,
}));

vi.mock('@/context/MarketContext', () => ({
    useMarket: () => ({
        t: (_key, _values, fallback) => fallback,
    }),
}));

vi.mock('@/i18n/useStableIcuMessages', () => ({
    useStableIcuMessages: (translate) => translate,
}));

vi.mock('@/context/NotificationContext', () => ({
    useNotifications: () => ({
        notifications: [{
            _id: 'notification-1',
            title: 'Order shipped',
            message: 'Your package is on its way.',
            type: 'order',
            priority: 'high',
            isRead: false,
            actionUrl: '/profile?tab=orders',
            actionLabel: 'Track order',
            createdAt: '2026-07-26T08:00:00.000Z',
        }],
        unreadCount: 1,
        markAsRead,
        markAllAsRead: vi.fn(),
        isLoading: false,
        fetchNotifications,
    }),
}));

describe('NotificationsSection', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('uses explicit keyboard actions instead of making the notification card clickable', async () => {
        render(<NotificationsSection />);

        expect(fetchNotifications).toHaveBeenCalledOnce();
        expect(screen.getByRole('heading', { name: 'Notification Center', level: 2 })).toBeInTheDocument();
        expect(screen.getByRole('heading', { name: 'Order shipped', level: 3 })).toBeInTheDocument();
        expect(screen.getByRole('listitem')).not.toHaveAttribute('tabindex');

        fireEvent.click(screen.getByRole('button', { name: 'Mark as read' }));
        expect(markAsRead).toHaveBeenCalledWith('notification-1');
        expect(navigate).not.toHaveBeenCalled();

        fireEvent.click(screen.getByRole('button', { name: 'Track order' }));

        await waitFor(() => {
            expect(navigate).toHaveBeenCalledWith('/profile?tab=orders');
        });
        expect(markAsRead).toHaveBeenCalledWith('notification-1');
    });
});

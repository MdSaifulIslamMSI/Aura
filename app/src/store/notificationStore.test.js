import { beforeEach, describe, expect, it, vi } from 'vitest';
import { notificationApi } from '@/services/api';
import { useNotificationStore } from './notificationStore';

vi.mock('@/services/api', () => ({
    notificationApi: {
        getNotifications: vi.fn(),
        markAsRead: vi.fn(),
        markAllAsRead: vi.fn(),
    },
}));

const initialState = () => ({
    isAuthenticated: false,
    notifications: [],
    unreadCount: 0,
    isLoading: false,
    lastFetchedAt: 0,
});

describe('notificationStore', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        useNotificationStore.setState(initialState());
    });

    it('starts from an empty, unauthenticated state', () => {
        expect(useNotificationStore.getState()).toMatchObject(initialState());
    });

    it('flips to authenticated once and fully resets when logging out', () => {
        useNotificationStore.setState({ notifications: [{ _id: '1', isRead: false }], unreadCount: 1 });

        useNotificationStore.getState().setAuthenticated(true);
        expect(useNotificationStore.getState().isAuthenticated).toBe(true);
        expect(useNotificationStore.getState().notifications).toHaveLength(1);

        useNotificationStore.getState().setAuthenticated(false);
        expect(useNotificationStore.getState()).toMatchObject(initialState());
    });

    it('normalizes, dedupes, and caps prepended notifications', () => {
        const store = useNotificationStore.getState();
        store.prependNotification({ _id: 'a', isRead: 1, priority: null });
        store.prependNotification({ _id: 'a' });
        store.prependNotification({ _id: 'b' });
        store.prependNotification({ noId: true });

        const { notifications, unreadCount } = useNotificationStore.getState();
        expect(notifications.map((entry) => entry._id)).toEqual(['b', 'a']);
        // Re-prepending the same id replaces the earlier entry with the new payload.
        expect(notifications[1]).toMatchObject({ _id: 'a', isRead: false, priority: 'medium', type: 'general' });
        expect(unreadCount).toBe(2);
    });

    it('never grows beyond 100 notifications', () => {
        for (let i = 0; i < 105; i += 1) {
            useNotificationStore.getState().prependNotification({ _id: `n-${i}` });
        }
        expect(useNotificationStore.getState().notifications).toHaveLength(100);
        expect(useNotificationStore.getState().notifications[0]._id).toBe('n-104');
    });

    it('short-circuits fetches while unauthenticated', async () => {
        const result = await useNotificationStore.getState().fetchNotifications({ force: true });

        expect(result).toEqual({ data: [], unreadCount: 0 });
        expect(notificationApi.getNotifications).not.toHaveBeenCalled();
    });

    it('normalizes fetched payloads and derives unread counts when the API omits them', async () => {
        useNotificationStore.setState({ isAuthenticated: true });
        notificationApi.getNotifications.mockResolvedValue({
            data: [{ _id: '1', isRead: 0 }, { _id: '2', priority: 'high' }, { bogus: true }],
            unreadCount: 'not-a-number',
        });

        const result = await useNotificationStore.getState().fetchNotifications({ force: true });

        expect(result.data).toHaveLength(2);
        expect(result.data[1]).toMatchObject({ _id: '2', isRead: false, priority: 'high' });
        expect(result.unreadCount).toBe(2);
        expect(useNotificationStore.getState().isLoading).toBe(false);
        expect(useNotificationStore.getState().lastFetchedAt).toBeGreaterThan(0);
    });

    it('serves the 30s cache and refetches once it goes stale', async () => {
        useNotificationStore.setState({ isAuthenticated: true });
        notificationApi.getNotifications.mockResolvedValue({ data: [{ _id: '1' }], unreadCount: 1 });

        await useNotificationStore.getState().fetchNotifications({ force: true });
        await useNotificationStore.getState().fetchNotifications();
        expect(notificationApi.getNotifications).toHaveBeenCalledTimes(1);

        useNotificationStore.setState({ lastFetchedAt: Date.now() - 31000 });
        await useNotificationStore.getState().fetchNotifications();
        expect(notificationApi.getNotifications).toHaveBeenCalledTimes(2);
    });

    it('does not flip isLoading for silent fetches', async () => {
        useNotificationStore.setState({ isAuthenticated: true });
        let resolveFetch;
        notificationApi.getNotifications.mockReturnValue(new Promise((resolve) => { resolveFetch = resolve; }));

        const pending = useNotificationStore.getState().fetchNotifications({ force: true, silent: true });
        expect(useNotificationStore.getState().isLoading).toBe(false);
        resolveFetch({ data: [], unreadCount: 0 });
        await pending;
    });

    it('marks a notification as read optimistically and calls the API', async () => {
        useNotificationStore.setState({
            notifications: [{ _id: '1', isRead: false }, { _id: '2', isRead: false }],
            unreadCount: 2,
        });
        notificationApi.markAsRead.mockResolvedValue({});

        await useNotificationStore.getState().markAsRead('1');

        expect(notificationApi.markAsRead).toHaveBeenCalledWith(['1']);
        const { notifications, unreadCount } = useNotificationStore.getState();
        expect(notifications.find((entry) => entry._id === '1').isRead).toBe(true);
        expect(unreadCount).toBe(1);
    });

    it('rolls back optimistic read state when the API call fails', async () => {
        useNotificationStore.setState({
            notifications: [{ _id: '1', isRead: false }],
            unreadCount: 1,
        });
        notificationApi.markAsRead.mockRejectedValue(new Error('offline'));

        await expect(useNotificationStore.getState().markAsRead('1')).rejects.toThrow('offline');
        expect(useNotificationStore.getState()).toMatchObject({
            notifications: [{ _id: '1', isRead: false }],
            unreadCount: 1,
        });
    });

    it('ignores blank, unknown, or already-read ids', async () => {
        useNotificationStore.setState({
            notifications: [{ _id: '1', isRead: true }],
            unreadCount: 0,
        });

        await useNotificationStore.getState().markAsRead('');
        await useNotificationStore.getState().markAsRead('missing');
        await useNotificationStore.getState().markAsRead('1');
        expect(notificationApi.markAsRead).not.toHaveBeenCalled();
    });

    it('marks everything as read and skips the work when nothing is pending', async () => {
        useNotificationStore.setState({
            notifications: [{ _id: '1', isRead: false }],
            unreadCount: 1,
        });
        notificationApi.markAllAsRead.mockResolvedValue({});

        await useNotificationStore.getState().markAllAsRead();
        expect(notificationApi.markAllAsRead).toHaveBeenCalledTimes(1);
        expect(useNotificationStore.getState().unreadCount).toBe(0);

        await useNotificationStore.getState().markAllAsRead();
        expect(notificationApi.markAllAsRead).toHaveBeenCalledTimes(1);
    });
});

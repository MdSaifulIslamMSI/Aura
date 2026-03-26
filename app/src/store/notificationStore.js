import { create } from 'zustand';
import { notificationApi } from '@/services/api';

const NOTIFICATION_CACHE_TTL_MS = 30 * 1000;
const MAX_NOTIFICATIONS = 100;

const createInitialState = () => ({
    isAuthenticated: false,
    notifications: [],
    unreadCount: 0,
    isLoading: false,
    lastFetchedAt: 0,
});

const normalizeNotification = (notification = {}) => ({
    ...notification,
    _id: String(notification?._id || ''),
    isRead: Boolean(notification?.isRead),
    priority: String(notification?.priority || 'medium'),
    type: String(notification?.type || 'general'),
});

const dedupeNotifications = (notifications = []) => {
    const seen = new Set();
    const next = [];

    notifications.forEach((entry) => {
        const normalized = normalizeNotification(entry);
        if (!normalized._id || seen.has(normalized._id)) {
            return;
        }

        seen.add(normalized._id);
        next.push(normalized);
    });

    return next.slice(0, MAX_NOTIFICATIONS);
};

const deriveUnreadCount = (notifications = []) => notifications.reduce(
    (count, notification) => count + (notification?.isRead ? 0 : 1),
    0
);

const buildFetchedState = ({ notifications = [], unreadCount } = {}) => {
    const normalizedNotifications = dedupeNotifications(notifications);
    const safeUnreadCount = Number.isFinite(Number(unreadCount))
        ? Number(unreadCount)
        : deriveUnreadCount(normalizedNotifications);

    return {
        notifications: normalizedNotifications,
        unreadCount: Math.max(0, safeUnreadCount),
        lastFetchedAt: Date.now(),
    };
};

export const useNotificationStore = create((set, get) => ({
    ...createInitialState(),
    setAuthenticated: (isAuthenticated) => set((state) => (
        isAuthenticated
            ? (state.isAuthenticated ? state : { ...state, isAuthenticated: true })
            : createInitialState()
    )),
    reset: () => set(createInitialState()),
    prependNotification: (notification) => set((state) => {
        const nextNotifications = dedupeNotifications([notification, ...state.notifications]);
        return {
            notifications: nextNotifications,
            unreadCount: deriveUnreadCount(nextNotifications),
            lastFetchedAt: Date.now(),
        };
    }),
    fetchNotifications: async ({ force = false, limit = 50, silent = false } = {}) => {
        const state = get();
        if (!state.isAuthenticated) {
            set(createInitialState());
            return { data: [], unreadCount: 0 };
        }

        const isFresh = state.lastFetchedAt > 0
            && (Date.now() - state.lastFetchedAt) < NOTIFICATION_CACHE_TTL_MS
            && state.notifications.length > 0;

        if (!force && isFresh) {
            return {
                data: state.notifications,
                unreadCount: state.unreadCount,
            };
        }

        if (!silent) {
            set({ isLoading: true });
        }

        try {
            const response = await notificationApi.getNotifications({ limit });
            const nextState = buildFetchedState({
                notifications: response?.data,
                unreadCount: response?.unreadCount,
            });

            set({
                ...nextState,
                isLoading: false,
            });

            return {
                data: nextState.notifications,
                unreadCount: nextState.unreadCount,
            };
        } catch (error) {
            if (!silent) {
                set({ isLoading: false });
            }
            throw error;
        }
    },
    markAsRead: async (id) => {
        const notificationId = String(id || '').trim();
        if (!notificationId) return;

        const previousState = get();
        const target = previousState.notifications.find((entry) => entry._id === notificationId);
        if (!target || target.isRead) {
            return;
        }

        const nextNotifications = previousState.notifications.map((entry) => (
            entry._id === notificationId ? { ...entry, isRead: true } : entry
        ));

        set({
            notifications: nextNotifications,
            unreadCount: Math.max(0, previousState.unreadCount - 1),
        });

        try {
            await notificationApi.markAsRead([notificationId]);
        } catch (error) {
            set({
                notifications: previousState.notifications,
                unreadCount: previousState.unreadCount,
            });
            throw error;
        }
    },
    markAllAsRead: async () => {
        const previousState = get();
        if (previousState.notifications.length === 0 || previousState.unreadCount === 0) {
            return;
        }

        set({
            notifications: previousState.notifications.map((entry) => ({ ...entry, isRead: true })),
            unreadCount: 0,
        });

        try {
            await notificationApi.markAllAsRead();
        } catch (error) {
            set({
                notifications: previousState.notifications,
                unreadCount: previousState.unreadCount,
            });
            throw error;
        }
    },
}));

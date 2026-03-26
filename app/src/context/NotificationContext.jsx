import { useEffect } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { toast } from 'sonner';
import { useSocket } from './SocketContext';
import { useAuth } from './AuthContext';
import { useNotificationStore } from '../store/notificationStore';

const DEFAULT_NOTIFICATION_CONTEXT = {
    notifications: [],
    unreadCount: 0,
    isLoading: false,
    markAsRead: async () => {},
    markAllAsRead: async () => {},
    fetchNotifications: async () => {},
};

export function useNotifications() {
    return useNotificationStore(useShallow((state) => ({
        notifications: state.notifications,
        unreadCount: state.unreadCount,
        isLoading: state.isLoading,
        markAsRead: state.markAsRead,
        markAllAsRead: state.markAllAsRead,
        fetchNotifications: state.fetchNotifications,
    }))) || DEFAULT_NOTIFICATION_CONTEXT;
}

export function NotificationProvider({ children }) {
    const { isAuthenticated } = useAuth();
    const { socket } = useSocket();
    const setAuthenticated = useNotificationStore((state) => state.setAuthenticated);
    const fetchNotifications = useNotificationStore((state) => state.fetchNotifications);
    const prependNotification = useNotificationStore((state) => state.prependNotification);

    useEffect(() => {
        setAuthenticated(isAuthenticated);

        if (!isAuthenticated) {
            return;
        }

        void fetchNotifications({ silent: true }).catch((error) => {
            if (import.meta.env.DEV) {
                console.error('Failed to prime notifications:', error);
            }
        });
    }, [fetchNotifications, isAuthenticated, setAuthenticated]);

    useEffect(() => {
        if (!socket || !isAuthenticated) return undefined;

        const handleNewNotification = (notification) => {
            prependNotification(notification);
            toast(notification?.title || 'New notification', {
                description: notification?.message || '',
                duration: 5000,
            });
        };

        socket.on('user:notification:new', handleNewNotification);

        return () => {
            socket.off('user:notification:new', handleNewNotification);
        };
    }, [socket, isAuthenticated, prependNotification]);

    return children;
}

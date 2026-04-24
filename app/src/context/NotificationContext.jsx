import { useEffect } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { toast } from 'sonner';
import { useMarket } from './MarketContext';
import { useSocket } from './SocketContext';
import { useAuth } from './AuthContext';
import { useNotificationStore } from '../store/notificationStore';
import { normalizeRuntimeTranslationText, requestRuntimeTranslations } from '../services/runtimeTranslation';
import {
    isInstalledAppRuntime,
    requestUserNotificationPermission,
    showSystemNotification,
} from '../services/nativeAppExperience';
import { useActiveWindowRefresh } from '../hooks/useActiveWindowRefresh';

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
    const { language, t } = useMarket();
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

    useActiveWindowRefresh(
        () => fetchNotifications({ force: true, silent: true }),
        { enabled: isAuthenticated }
    );

    useEffect(() => {
        if (!isAuthenticated || !isInstalledAppRuntime()) {
            return;
        }

        void requestUserNotificationPermission();
    }, [isAuthenticated]);

    useEffect(() => {
        if (!socket || !isAuthenticated) return undefined;

        const handleNewNotification = (notification) => {
            prependNotification(notification);
            const title = notification?.title || t('notifications.new', {}, 'New notification');
            const description = notification?.message || '';
            const tag = String(notification?._id || notification?.id || notification?.createdAt || 'aura-notification');

            const surfaceNotification = (resolvedTitle, resolvedDescription) => {
                toast(resolvedTitle, { description: resolvedDescription, duration: 5000 });
                void showSystemNotification({
                    title: resolvedTitle,
                    body: resolvedDescription,
                    tag: `aura-notification-${tag}`,
                    data: notification,
                    requireBackground: true,
                });
            };

            if (language === 'en') {
                surfaceNotification(title, description);
                return;
            }

            void requestRuntimeTranslations({
                texts: [title, description],
                language,
            }).then((translations) => {
                const translatedTitle = translations[normalizeRuntimeTranslationText(title)] || title;
                const translatedDescription = translations[normalizeRuntimeTranslationText(description)] || description;
                surfaceNotification(translatedTitle, translatedDescription);
            }).catch(() => {
                surfaceNotification(title, description);
            });
        };

        socket.on('user:notification:new', handleNewNotification);

        return () => {
            socket.off('user:notification:new', handleNewNotification);
        };
    }, [socket, isAuthenticated, language, prependNotification, t]);

    return children;
}

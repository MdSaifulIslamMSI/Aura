import { createContext, useContext, useState, useEffect } from 'react';
import { notificationApi } from '../services/api';
import { useSocket } from './SocketContext';
import { useAuth } from './AuthContext';
import { toast } from 'sonner';

const DEFAULT_NOTIFICATION_CONTEXT = {
    notifications: [],
    unreadCount: 0,
    isLoading: false,
    markAsRead: async () => {},
    markAllAsRead: async () => {},
    fetchNotifications: async () => {},
};

const NotificationContext = createContext(DEFAULT_NOTIFICATION_CONTEXT);

export function useNotifications() {
    return useContext(NotificationContext) || DEFAULT_NOTIFICATION_CONTEXT;
}

export function NotificationProvider({ children }) {
    const { isAuthenticated } = useAuth();
    const { socket } = useSocket();
    const [notifications, setNotifications] = useState([]);
    const [unreadCount, setUnreadCount] = useState(0);
    const [isLoading, setIsLoading] = useState(false);

    const fetchNotifications = async () => {
        if (!isAuthenticated) return;
        try {
            setIsLoading(true);
            const { data, unreadCount } = await notificationApi.getNotifications({ limit: 50 });
            setNotifications(data || []);
            setUnreadCount(unreadCount || 0);
        } catch (error) {
            if (import.meta.env.DEV) {
                console.error('Failed to fetch notifications:', error);
            }
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        if (!isAuthenticated) {
            setNotifications([]);
            setUnreadCount(0);
        }
    }, [isAuthenticated]);

    useEffect(() => {
        if (!socket || !isAuthenticated) return;

        const handleNewNotification = (notification) => {
            setNotifications(prev => [notification, ...prev]);
            setUnreadCount(prev => prev + 1);
            toast(notification.title, {
                icon: '🔔',
                duration: 5000,
            });
        };

        socket.on('user:notification:new', handleNewNotification);

        return () => {
            socket.off('user:notification:new', handleNewNotification);
        };
    }, [socket, isAuthenticated]);

    const markAsRead = async (id) => {
        try {
            setNotifications(prev => 
                prev.map(n => n._id === id ? { ...n, isRead: true } : n)
            );
            setUnreadCount(prev => Math.max(0, prev - 1));
            await notificationApi.markAsRead([id]);
        } catch (error) {
            if (import.meta.env.DEV) {
                console.error('Failed to mark notification as read:', error);
            }
        }
    };

    const markAllAsRead = async () => {
        try {
            setNotifications(prev => prev.map(n => ({ ...n, isRead: true })));
            setUnreadCount(0);
            await notificationApi.markAllAsRead();
        } catch (error) {
            if (import.meta.env.DEV) {
                console.error('Failed to mark all as read:', error);
            }
        }
    };

    return (
        <NotificationContext.Provider value={{
            notifications,
            unreadCount,
            isLoading,
            markAsRead,
            markAllAsRead,
            fetchNotifications
        }}>
            {children}
        </NotificationContext.Provider>
    );
}

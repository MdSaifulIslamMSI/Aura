import { useState, useRef, useEffect } from 'react';
import { Bell, Check, ExternalLink } from 'lucide-react';
import { useNotifications } from '../../../context/NotificationContext';
import { cn } from '@/lib/utils';
import { Link, useNavigate } from 'react-router-dom';

const NotificationDropdown = ({ isCompact = false, isOpen: controlledIsOpen, onOpenChange }) => {
    const { notifications, unreadCount, markAsRead, markAllAsRead, isLoading, fetchNotifications } = useNotifications();
    const [internalIsOpen, setInternalIsOpen] = useState(false);
    const dropdownRef = useRef(null);
    const navigate = useNavigate();
    const isControlled = typeof controlledIsOpen === 'boolean';
    const isOpen = isControlled ? controlledIsOpen : internalIsOpen;

    const setIsOpen = (nextValue) => {
        if (!isControlled) {
            setInternalIsOpen(nextValue);
        }
        onOpenChange?.(nextValue);
    };

    useEffect(() => {
        const handleClickOutside = (event) => {
            if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
                setIsOpen(false);
            }
        };

        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    useEffect(() => {
        if (!isOpen) return;
        fetchNotifications();
    }, [fetchNotifications, isOpen]);

    const handleNotificationClick = async (notification) => {
        if (!notification.isRead) {
            await markAsRead(notification._id);
        }
        setIsOpen(false);
        if (notification.actionUrl) {
            navigate(notification.actionUrl);
        }
    };

    const getIconColor = (type) => {
        switch (type) {
            case 'order': return 'text-sky-400 bg-sky-400/10 border-sky-400/20';
            case 'payment': return 'text-emerald-400 bg-emerald-400/10 border-emerald-400/20';
            case 'governance': return 'text-rose-400 bg-rose-400/10 border-rose-400/20';
            case 'support': return 'text-violet-400 bg-violet-400/10 border-violet-400/20';
            case 'listing': return 'text-amber-400 bg-amber-400/10 border-amber-400/20';
            default: return 'text-slate-400 bg-slate-400/10 border-slate-400/20';
        }
    };

    return (
        <div className="relative" ref={dropdownRef}>
            <button
                onClick={() => setIsOpen(!isOpen)}
                className={cn(
                    'relative flex h-10 w-10 items-center justify-center rounded-full border border-white/10 bg-white/[0.045] text-slate-200 transition-all hover:border-white/18 hover:bg-white/[0.08] hover:text-white',
                    isOpen && 'border-cyan-300/35 bg-cyan-400/12 text-white shadow-[0_0_18px_rgba(34,211,238,0.18)]'
                )}
                aria-label="Open notifications"
                aria-expanded={isOpen}
            >
                <Bell className="h-[1.125rem] w-[1.125rem]" />
                {unreadCount > 0 && (
                    <span className="absolute -right-1 -top-1 flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-rose-500 px-1 text-[9px] font-bold text-white ring-2 ring-[#0f172a]">
                        {unreadCount > 99 ? '99+' : unreadCount}
                    </span>
                )}
            </button>

            {isOpen && (
                <>
                    {isCompact && (
                        <button
                            type="button"
                            aria-label="Close notifications backdrop"
                            className="fixed inset-0 z-[90] bg-zinc-950/45"
                            onClick={() => setIsOpen(false)}
                        />
                    )}
                    <div
                        className={cn(
                            'overflow-hidden rounded-2xl border border-white/10 bg-[#0f172a]/95 p-0 shadow-2xl backdrop-blur-xl ring-1 ring-white/5',
                            isCompact
                                ? 'fixed inset-x-3 top-[5.5rem] z-[100] max-h-[min(30rem,calc(100vh-6rem))]'
                                : 'absolute right-0 top-[calc(100%+0.5rem)] z-[100] w-[22rem] max-w-[calc(100vw-2rem)] sm:w-[24rem]'
                        )}
                    >
                    <div className="flex items-center justify-between border-b border-white/5 bg-white/[0.02] px-4 py-3">
                        <div>
                            <h3 className="text-sm font-semibold text-white">Notifications</h3>
                            {isCompact && <p className="mt-0.5 text-[11px] text-slate-400">Priority updates without crowding the route.</p>}
                        </div>
                        <div className="flex items-center gap-2">
                            {unreadCount > 0 && (
                                <button
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        markAllAsRead();
                                    }}
                                    className="flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-neo-cyan transition-colors hover:bg-cyan-500/10"
                                >
                                    <Check className="h-3 w-3" />
                                    Mark all as read
                                </button>
                            )}
                            {isCompact && (
                                <button
                                    type="button"
                                    onClick={() => setIsOpen(false)}
                                    className="rounded-md px-2 py-1 text-xs font-medium text-slate-300 transition-colors hover:bg-white/[0.08] hover:text-white"
                                >
                                    Close
                                </button>
                            )}
                        </div>
                    </div>

                    <div className={cn('overflow-y-auto', isCompact ? 'max-h-[calc(min(30rem,100vh-6rem)-7rem)]' : 'max-h-[28rem]')}>
                        {isLoading && notifications.length === 0 ? (
                            <div className="flex flex-col items-center justify-center py-8 text-slate-400">
                                <div className="h-5 w-5 animate-spin rounded-full border-2 border-slate-400 border-t-transparent" />
                                <span className="mt-2 text-xs">Loading logs...</span>
                            </div>
                        ) : notifications.length === 0 ? (
                            <div className="flex flex-col items-center justify-center py-10 text-center">
                                <Bell className="mb-2 h-8 w-8 text-slate-600" />
                                <p className="text-sm font-medium text-slate-300">No new notifications</p>
                                <p className="mt-1 text-xs text-slate-500">We'll let you know when something happens.</p>
                            </div>
                        ) : (
                            <div className="flex flex-col divide-y divide-white/5">
                                {notifications.map((notification) => (
                                    <div
                                        key={notification._id}
                                        onClick={() => handleNotificationClick(notification)}
                                        className={cn(
                                            "group cursor-pointer flex gap-3 p-4 transition-colors hover:bg-white/[0.04]",
                                            !notification.isRead ? "bg-white/[0.02]" : "opacity-70 grayscale-[0.5]"
                                        )}
                                    >
                                        <div className={cn(
                                            "mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border",
                                            getIconColor(notification.type)
                                        )}>
                                            <Bell className="h-3.5 w-3.5" />
                                        </div>
                                        <div className="min-w-0 flex-1">
                                            <div className="flex items-center justify-between gap-2">
                                                <p className={cn(
                                                    "truncate text-sm font-semibold",
                                                    !notification.isRead ? "text-white" : "text-slate-300"
                                                )}>
                                                    {notification.title}
                                                </p>
                                                {!notification.isRead && (
                                                    <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-neo-cyan" />
                                                )}
                                            </div>
                                            <p className="mt-0.5 line-clamp-2 text-xs text-slate-400">
                                                {notification.message}
                                            </p>
                                            <div className="mt-1.5 flex items-center justify-between text-[10px] font-medium text-slate-500">
                                                <span>{new Date(notification.createdAt).toLocaleString()}</span>
                                                {notification.actionUrl && (
                                                    <span className="flex items-center gap-1 text-neo-cyan opacity-0 transition-opacity group-hover:opacity-100">
                                                        View details <ExternalLink className="h-2.5 w-2.5" />
                                                    </span>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                    {notifications.length > 0 && (
                        <div className="border-t border-white/5 bg-white/[0.01] p-2 text-center">
                            <Link
                                to="/profile"
                                onClick={() => setIsOpen(false)}
                                className="inline-block px-4 py-1 flex items-center justify-center text-xs font-semibold text-slate-400 hover:text-white transition-colors"
                            >
                                View all in Profile
                            </Link>
                        </div>
                    )}
                    </div>
                </>
            )}
        </div>
    );
};

export default NotificationDropdown;

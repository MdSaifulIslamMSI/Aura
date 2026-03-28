import { useEffect, useMemo, useState } from 'react';
import { Bell, Check, ExternalLink } from 'lucide-react';
import { useNotifications } from '@/context/NotificationContext';
import { cn } from '@/lib/utils';
import { useNavigate } from 'react-router-dom';
import { useMarket } from '@/context/MarketContext';

export default function NotificationsSection() {
    const { notifications, unreadCount, markAsRead, markAllAsRead, isLoading, fetchNotifications } = useNotifications();
    const { t } = useMarket();
    const [filter, setFilter] = useState('all');
    const navigate = useNavigate();

    useEffect(() => {
        fetchNotifications();
    }, [fetchNotifications]);

    const filteredNotifications = useMemo(() => notifications.filter((notification) => {
        if (filter === 'unread' && notification.isRead) return false;
        if (filter === 'read' && !notification.isRead) return false;
        return true;
    }), [filter, notifications]);

    const handleNotificationClick = async (notification) => {
        if (!notification.isRead) {
            await markAsRead(notification._id);
        }
        if (notification.actionUrl) {
            navigate(notification.actionUrl);
        }
    };

    const getTypeStyles = (type) => {
        switch (type) {
            case 'order': return 'text-sky-400 bg-sky-400/10 border-sky-400/20';
            case 'payment': return 'text-emerald-400 bg-emerald-400/10 border-emerald-400/20';
            case 'governance': return 'text-rose-400 bg-rose-400/10 border-rose-400/20';
            case 'support': return 'text-violet-400 bg-violet-400/10 border-violet-400/20';
            case 'listing': return 'text-amber-400 bg-amber-400/10 border-amber-400/20';
            default: return 'text-slate-400 bg-slate-400/10 border-slate-400/20';
        }
    };

    const getPriorityStyles = (priority) => {
        switch (priority) {
            case 'critical': return 'border-rose-400/25 bg-rose-500/12 text-rose-100';
            case 'high': return 'border-amber-400/20 bg-amber-500/12 text-amber-100';
            case 'low': return 'border-slate-400/15 bg-slate-500/8 text-slate-300';
            default: return 'border-cyan-300/20 bg-cyan-500/12 text-cyan-100';
        }
    };

    const filterOptions = [
        { value: 'all', label: t('profile.notifications.filter.all', {}, 'all') },
        { value: 'unread', label: t('profile.notifications.filter.unread', {}, 'unread') },
        { value: 'read', label: t('profile.notifications.filter.read', {}, 'read') },
    ];

    const formatTypeLabel = (type) => t(`profile.notifications.type.${String(type || 'system').toLowerCase()}`, {}, type || 'system');
    const formatPriorityLabel = (priority) => t(`profile.notifications.priority.${String(priority || 'medium').toLowerCase()}`, {}, priority || 'medium');

    return (
        <div className="animate-fade-in space-y-6">
            <div className="flex flex-col justify-between gap-4 md:flex-row md:items-center">
                <div>
                    <h2 className="text-3xl font-black uppercase tracking-tight text-white">{t('profile.notifications.title', {}, 'Notification Center')}</h2>
                    <p className="mt-1 text-slate-400">{t('profile.notifications.body', {}, 'Review your account alerts and operational history.')}</p>
                </div>
                {unreadCount > 0 ? (
                    <button
                        onClick={markAllAsRead}
                        className="inline-flex items-center gap-2 rounded-xl border border-neo-cyan/20 bg-neo-cyan/10 px-4 py-2 font-bold text-neo-cyan transition-all active:scale-95 hover:bg-neo-cyan/20"
                    >
                        <Check className="h-4 w-4" />
                        {t('profile.notifications.markAllRead', {}, 'Mark All as Read')}
                    </button>
                ) : null}
            </div>

            <div className="w-fit rounded-2xl border border-white/10 bg-white/[0.03] p-1.5">
                {filterOptions.map((option) => (
                    <button
                        key={option.value}
                        onClick={() => setFilter(option.value)}
                        className={cn(
                            'rounded-xl px-4 py-2 text-sm font-bold capitalize transition-all',
                            filter === option.value ? 'bg-white/10 text-white shadow-lg' : 'text-slate-500 hover:text-slate-300',
                        )}
                    >
                        {option.label}
                        {option.value === 'unread' && unreadCount > 0 ? (
                            <span className="ml-2 rounded-full bg-rose-500 px-1.5 py-0.5 text-[10px] text-white">
                                {unreadCount}
                            </span>
                        ) : null}
                    </button>
                ))}
            </div>

            <div className="grid grid-cols-1 gap-4">
                {isLoading && notifications.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-20 text-center text-sm italic text-slate-500">
                        <div className="mb-4 h-10 w-10 animate-spin rounded-full border-4 border-neo-cyan border-t-transparent" />
                        {t('profile.notifications.loading', {}, 'Syncing persistent logs...')}
                    </div>
                ) : filteredNotifications.length === 0 ? (
                    <div className="flex flex-col items-center justify-center rounded-[2.5rem] border-4 border-dashed border-white/5 px-6 py-24 text-center">
                        <div className="mb-6 flex h-24 w-24 items-center justify-center rounded-full bg-white/5">
                            <Bell className="h-10 w-10 text-slate-600" />
                        </div>
                        <h3 className="text-2xl font-black uppercase text-white">{t('profile.notifications.empty.title', {}, 'History Clear')}</h3>
                        <p className="mt-2 max-w-sm text-slate-400">
                            {t('profile.notifications.empty.body', {}, "You're all caught up. Governance actions, support replies, commerce alerts, and recovery prompts will appear here.")}
                        </p>
                    </div>
                ) : (
                    <div className="space-y-3">
                        {filteredNotifications.map((notification) => (
                            <div
                                key={notification._id}
                                onClick={() => handleNotificationClick(notification)}
                                className={cn(
                                    'group relative flex cursor-pointer flex-col gap-4 rounded-[2rem] border p-5 transition-all md:flex-row md:items-center',
                                    !notification.isRead
                                        ? 'border-white/10 bg-white/[0.05] shadow-xl hover:border-white/20 hover:bg-white/[0.08]'
                                        : 'border-white/5 bg-transparent opacity-60 hover:bg-white/[0.02] hover:opacity-100',
                                )}
                            >
                                <div className={cn('flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl border-2', getTypeStyles(notification.type))}>
                                    <Bell className="h-6 w-6" />
                                </div>
                                <div className="min-w-0 flex-1">
                                    <div className="mb-1 flex items-center gap-2">
                                        <h4 className={cn('truncate text-xl font-bold', !notification.isRead ? 'text-white' : 'text-slate-300')}>
                                            {notification.title}
                                        </h4>
                                        <span className="rounded-full bg-white/5 px-2 py-0.5 text-[10px] font-black uppercase tracking-widest text-slate-500">
                                            {formatTypeLabel(notification.type)}
                                        </span>
                                        <span className={cn('rounded-full border px-2 py-0.5 text-[10px] font-black uppercase tracking-widest', getPriorityStyles(notification.priority))}>
                                            {formatPriorityLabel(notification.priority)}
                                        </span>
                                    </div>
                                    <p className="line-clamp-2 text-sm text-slate-400 md:line-clamp-1">{notification.message}</p>
                                    <div className="mt-2 flex items-center gap-3 text-xs font-medium text-slate-500">
                                        <span>{new Date(notification.createdAt).toLocaleString()}</span>
                                        {!notification.isRead ? (
                                            <span className="flex items-center gap-1.5 text-neo-cyan">
                                                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-neo-cyan" />
                                                {t('profile.notifications.newAlert', {}, 'New Alert')}
                                            </span>
                                        ) : null}
                                    </div>
                                </div>
                                <div className="flex items-center gap-3">
                                    {notification.actionUrl ? (
                                        <div className="hidden items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-xs font-bold text-slate-300 transition-all group-hover:bg-white/10 group-hover:text-white md:flex">
                                            {notification.actionLabel || t('profile.shared.open', {}, 'Open')} <ExternalLink className="h-3.5 w-3.5" />
                                        </div>
                                    ) : null}
                                    {!notification.isRead ? (
                                        <button
                                            onClick={(event) => {
                                                event.stopPropagation();
                                                markAsRead(notification._id);
                                            }}
                                            className="rounded-xl border border-white/10 bg-white/5 p-2 text-slate-400 transition-all hover:border-neo-cyan/30 hover:bg-neo-cyan/10 hover:text-neo-cyan"
                                            title={t('profile.notifications.markReadTitle', {}, 'Mark as read')}
                                        >
                                            <Check className="h-5 w-5" />
                                        </button>
                                    ) : null}
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}

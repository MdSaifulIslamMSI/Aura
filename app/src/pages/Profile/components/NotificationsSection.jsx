import { useEffect, useState } from 'react';
import { Bell, Check, Trash2, ExternalLink, Filter, Search } from 'lucide-react';
import { useNotifications } from '@/context/NotificationContext';
import { cn } from '@/lib/utils';
import { useNavigate } from 'react-router-dom';

export default function NotificationsSection() {
    const { notifications, unreadCount, markAsRead, markAllAsRead, isLoading, fetchNotifications } = useNotifications();
    const [filter, setFilter] = useState('all'); // all, unread, read
    const [typeFilter, setTypeFilter] = useState('all'); // all, order, payment, governance, etc.
    const navigate = useNavigate();

    useEffect(() => {
        fetchNotifications();
    }, [fetchNotifications]);

    const filteredNotifications = notifications.filter(n => {
        if (filter === 'unread' && n.isRead) return false;
        if (filter === 'read' && !n.isRead) return false;
        if (typeFilter !== 'all' && n.type !== typeFilter) return false;
        return true;
    });

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

    return (
        <div className="space-y-6 animate-fade-in">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                    <h2 className="text-3xl font-black text-white uppercase tracking-tight">Notification Center</h2>
                    <p className="text-slate-400 mt-1">Review your account alerts and operational history.</p>
                </div>
                {unreadCount > 0 && (
                    <button
                        onClick={markAllAsRead}
                        className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-neo-cyan/10 border border-neo-cyan/20 text-neo-cyan font-bold hover:bg-neo-cyan/20 transition-all active:scale-95"
                    >
                        <Check className="w-4 h-4" />
                        Mark All as Read
                    </button>
                )}
            </div>

            <div className="flex flex-wrap gap-2 p-1.5 rounded-2xl bg-white/[0.03] border border-white/10 w-fit">
                {['all', 'unread', 'read'].map(f => (
                    <button
                        key={f}
                        onClick={() => setFilter(f)}
                        className={cn(
                            "px-4 py-2 rounded-xl text-sm font-bold capitalize transition-all",
                            filter === f ? "bg-white/10 text-white shadow-lg" : "text-slate-500 hover:text-slate-300"
                        )}
                    >
                        {f}
                        {f === 'unread' && unreadCount > 0 && (
                            <span className="ml-2 px-1.5 py-0.5 rounded-full bg-rose-500 text-[10px] text-white">
                                {unreadCount}
                            </span>
                        )}
                    </button>
                ))}
            </div>

            <div className="grid grid-cols-1 gap-4">
                {isLoading && notifications.length === 0 ? (
                    <div className="py-20 flex flex-col items-center justify-center text-slate-500 italic">
                        <div className="w-10 h-10 border-4 border-neo-cyan border-t-transparent rounded-full animate-spin mb-4" />
                        Syncing persistent logs...
                    </div>
                ) : filteredNotifications.length === 0 ? (
                    <div className="py-24 rounded-[2.5rem] border-4 border-dashed border-white/5 flex flex-col items-center justify-center text-center px-6">
                        <div className="w-24 h-24 rounded-full bg-white/5 flex items-center justify-center mb-6">
                            <Bell className="w-10 h-10 text-slate-600" />
                        </div>
                        <h3 className="text-2xl font-black text-white uppercase">History Clear</h3>
                        <p className="text-slate-400 mt-2 max-w-sm">
                            You're all caught up. Notifications related to orders, payments, and account status will appear here.
                        </p>
                    </div>
                ) : (
                    <div className="space-y-3">
                        {filteredNotifications.map((n) => (
                            <div
                                key={n._id}
                                onClick={() => handleNotificationClick(n)}
                                className={cn(
                                    "group relative flex flex-col md:flex-row md:items-center gap-4 p-5 rounded-[2rem] border transition-all cursor-pointer",
                                    !n.isRead 
                                        ? "bg-white/[0.05] border-white/10 hover:bg-white/[0.08] hover:border-white/20 shadow-xl" 
                                        : "bg-transparent border-white/5 opacity-60 hover:opacity-100 hover:bg-white/[0.02]"
                                )}
                            >
                                <div className={cn(
                                    "flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl border-2",
                                    getTypeStyles(n.type)
                                )}>
                                    <Bell className="h-6 w-6" />
                                </div>
                                <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-2 mb-1">
                                        <h4 className={cn(
                                            "text-xl font-bold truncate",
                                            !n.isRead ? "text-white" : "text-slate-300"
                                        )}>
                                            {n.title}
                                        </h4>
                                        <span className="text-[10px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full bg-white/5 text-slate-500">
                                            {n.type}
                                        </span>
                                    </div>
                                    <p className="text-slate-400 text-sm line-clamp-2 md:line-clamp-1">
                                        {n.message}
                                    </p>
                                    <div className="mt-2 flex items-center gap-3 text-xs text-slate-500 font-medium">
                                        <span>{new Date(n.createdAt).toLocaleString()}</span>
                                        {!n.isRead && (
                                            <span className="flex items-center gap-1.5 text-neo-cyan">
                                                <span className="w-1.5 h-1.5 rounded-full bg-neo-cyan animate-pulse" />
                                                New Alert
                                            </span>
                                        )}
                                    </div>
                                </div>
                                <div className="flex items-center gap-3">
                                    {n.actionUrl && (
                                        <div className="hidden md:flex items-center gap-2 px-4 py-2 rounded-xl bg-white/5 border border-white/10 text-slate-300 text-xs font-bold group-hover:bg-white/10 group-hover:text-white transition-all">
                                            View Logs <ExternalLink className="w-3.5 h-3.5" />
                                        </div>
                                    )}
                                    {!n.isRead && (
                                        <button
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                markAsRead(n._id);
                                            }}
                                            className="p-2 rounded-xl bg-white/5 border border-white/10 text-slate-400 hover:text-neo-cyan hover:bg-neo-cyan/10 hover:border-neo-cyan/30 transition-all"
                                            title="Mark as read"
                                        >
                                            <Check className="w-5 h-5" />
                                        </button>
                                    )}
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}

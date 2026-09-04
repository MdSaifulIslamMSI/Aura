import { LifeBuoy, Plus, RefreshCw, Wifi, WifiOff } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
    createInitialForm,
    formatSupportPriority,
    formatThreadPreviewTime,
    getInitials,
    getPriorityBadge,
} from './supportHelpers';
import { getStatusBadge } from './supportBadges';

export default function TicketInbox({
    t,
    translateSupportText,
    connectionState,
    isSocketReconnecting,
    socketStatusLabel,
    error,
    loading,
    tickets,
    activeTicketId,
    creating,
    categoryMap,
    prefill,
    setCreating,
    setActiveTicketId,
    setForm,
    fetchTickets,
}) {
    return (
        <div className="support-workspace__inbox premium-panel flex min-h-[20rem] flex-col overflow-hidden p-0 xl:min-h-[42rem]">
        <div className="border-b border-white/10 px-5 py-5">
            <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                    <p className="text-[11px] font-black uppercase tracking-[0.28em] text-emerald-200">{t('profile.support.inbox.kicker', {}, 'Support inbox')}</p>
                    <h2 className="mt-2 text-2xl font-black text-white">{t('profile.support.inbox.title', {}, 'Chat with Aura Support')}</h2>
                    <p className="mt-1.5 text-sm text-slate-400">
                        {t('profile.support.inbox.body', {}, 'Appeals, order issues, and live support handoffs stay in one conversation flow.')}
                    </p>
                </div>
                <div className={cn(
                    'inline-flex shrink-0 items-center gap-2 rounded-full border px-3 py-1.5 text-[11px] font-bold',
                    connectionState === 'connected'
                        ? 'border-emerald-300/20 bg-emerald-500/12 text-emerald-100'
                        : isSocketReconnecting
                            ? 'border-amber-300/20 bg-amber-500/12 text-amber-100'
                            : 'border-rose-300/20 bg-rose-500/12 text-rose-100'
                )}>
                    {connectionState === 'connected' ? <Wifi className="h-3.5 w-3.5" /> : <WifiOff className="h-3.5 w-3.5" />}
                    {socketStatusLabel}
                </div>
            </div>

            <div className="mt-4 flex flex-wrap gap-2">
                <button
                    type="button"
                    onClick={() => {
                        setCreating(true);
                        setActiveTicketId(null);
                        setForm(createInitialForm(prefill, categoryMap));
                    }}
                    className="support-chat-send inline-flex items-center gap-2 px-4 py-2 text-sm font-black"
                >
                    <Plus className="h-4 w-4" />
                    {t('profile.support.inbox.newChat', {}, 'New chat')}
                </button>
                <button
                    type="button"
                    onClick={() => fetchTickets()}
                    className="support-chat-utility inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold"
                >
                    <RefreshCw className="h-4 w-4" />
                    {t('profile.support.inbox.refresh', {}, 'Refresh')}
                </button>
            </div>

            {error ? (
                <div className="mt-4 rounded-2xl border border-rose-400/20 bg-rose-500/12 px-4 py-3 text-sm text-rose-100">
                    {translateSupportText(error)}
                </div>
            ) : null}
        </div>

        <div className="flex-1 overflow-y-auto p-3 scrollbar-hide">
            {loading ? (
                <div className="flex h-full items-center justify-center px-6 text-center text-sm text-slate-400">
                    {t('profile.support.inbox.loading', {}, 'Loading your support threads...')}
                </div>
            ) : tickets.length === 0 ? (
                <div className="flex h-full flex-col items-center justify-center px-6 text-center">
                    <div className="support-chat-avatar h-16 w-16 text-emerald-100">
                        <LifeBuoy className="h-8 w-8" />
                    </div>
                    <h3 className="mt-5 text-lg font-black text-white">{t('profile.support.inbox.emptyTitle', {}, 'No chats yet')}</h3>
                    <p className="mt-2 max-w-xs text-sm text-slate-400">
                        {t('profile.support.inbox.emptyBody', {}, 'Start a thread when you need help with moderation, orders, or account support.')}
                    </p>
                </div>
            ) : (
                <div className="space-y-3">
                    {tickets.map((ticket) => (
                        <button
                            key={ticket._id}
                            type="button"
                            onClick={() => {
                                setActiveTicketId(ticket._id);
                                setCreating(false);
                            }}
                            className={cn(
                                'support-chat-card w-full p-4 text-left transition-all',
                                String(activeTicketId) === String(ticket._id) && !creating ? 'support-chat-card-active' : ''
                            )}
                        >
                            <div className="flex items-start gap-3">
                                <div className="support-chat-avatar h-12 w-12 shrink-0 text-sm font-black">
                                    {getInitials(categoryMap.get(ticket.category)?.label || translateSupportText(ticket.subject))}
                                </div>

                                <div className="min-w-0 flex-1">
                                    <div className="flex items-start justify-between gap-3">
                                        <div className="min-w-0">
                                            <div className="truncate text-sm font-black text-white">{translateSupportText(ticket.subject)}</div>
                                            <div className="mt-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">
                                                {categoryMap.get(ticket.category)?.label || ticket.category}
                                            </div>
                                        </div>
                                        <span className="shrink-0 text-[11px] font-medium text-slate-400">
                                            {formatThreadPreviewTime(ticket.lastMessageAt || ticket.updatedAt || ticket.createdAt, t)}
                                        </span>
                                    </div>

                                    <div className="mt-3 line-clamp-2 text-sm leading-6 text-slate-300">
                                        {translateSupportText(ticket.lastMessagePreview) || t('profile.support.thread.noMessages', {}, 'No messages yet.')}
                                    </div>

                                    <div className="mt-3 flex items-center justify-between gap-3">
                                        <div className="flex flex-wrap items-center gap-2">
                                            <span className={cn(
                                                'rounded-full border px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.18em]',
                                                getPriorityBadge(ticket.priority)
                                            )}>
                                                {formatSupportPriority(ticket.priority, t)}
                                            </span>
                                            {ticket.userActionRequired ? (
                                                <span className="rounded-full border border-rose-300/20 bg-rose-500/12 px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.18em] text-rose-100">
                                                    {t('profile.support.thread.replyNeeded', {}, 'Reply needed')}
                                                </span>
                                            ) : (
                                                <span className="rounded-full border border-white/10 bg-white/[0.05] px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.18em] text-slate-300">
                                                    {ticket.lastActorRole === 'admin'
                                                        ? t('profile.support.thread.auraReplied', {}, 'Aura replied')
                                                        : t('profile.support.thread.youReplied', {}, 'You replied')}
                                                </span>
                                            )}
                                        </div>

                                        <div className="flex shrink-0 items-center gap-2">
                                            {ticket.unreadByUser > 0 ? (
                                                <span className="rounded-full bg-emerald-400 px-2.5 py-1 text-[10px] font-black text-[#032114]">
                                                    {ticket.unreadByUser}
                                                </span>
                                            ) : null}
                                            {getStatusBadge(ticket.status, t)}
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </button>
                    ))}
                </div>
            )}
        </div>
        </div>
    );
}

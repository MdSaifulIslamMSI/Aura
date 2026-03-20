import { useCallback, useEffect, useRef, useState } from 'react';
import {
    AlertCircle,
    CheckCircle,
    Clock,
    MessageSquare,
    PhoneCall,
    RefreshCw,
    Send,
    ShieldAlert,
    Wifi,
    WifiOff,
    X,
} from 'lucide-react';
import { supportApi } from '@/services/api';
import { cn } from '@/lib/utils';
import AdminPremiumShell from '@/components/shared/AdminPremiumShell';
import PremiumSelect from '@/components/ui/premium-select';
import { useSocket, useSocketDemand } from '@/context/SocketContext';
import { useVideoCall } from '@/context/VideoCallContext';

const TICKET_LIST_POLL_MS = 20000;
const ACTIVE_TICKET_POLL_MS = 12000;

const sortTickets = (tickets = []) => (
    [...tickets].sort((left, right) => {
        const leftTime = new Date(left?.lastMessageAt || 0).getTime();
        const rightTime = new Date(right?.lastMessageAt || 0).getTime();
        return rightTime - leftTime;
    })
);

const normalizeTicket = (ticket) => {
    if (!ticket) return null;
    return {
        ...ticket,
        unreadByAdmin: Number(ticket.unreadByAdmin || 0),
        unreadByUser: Number(ticket.unreadByUser || 0),
    };
};

const upsertTicket = (tickets, ticket, statusFilter = '') => {
    const normalized = normalizeTicket(ticket);
    if (!normalized?._id) return tickets;

    const next = tickets.filter((entry) => String(entry._id) !== String(normalized._id));
    const matchesFilter = !statusFilter || String(normalized.status || '') === String(statusFilter);
    if (!matchesFilter) {
        return sortTickets(next);
    }

    return sortTickets([normalized, ...next]);
};

const appendUniqueMessage = (messages, incoming) => {
    if (!incoming) return messages;

    const incomingId = String(incoming._id || '');
    if (incomingId && messages.some((entry) => String(entry?._id || '') === incomingId)) {
        return messages;
    }

    return [...messages, incoming].sort((left, right) => {
        const leftTime = new Date(left?.sentAt || left?.createdAt || 0).getTime();
        const rightTime = new Date(right?.sentAt || right?.createdAt || 0).getTime();
        return leftTime - rightTime;
    });
};

export default function AdminSupport() {
    useSocketDemand('admin-support', true);
    const { socket, isConnected } = useSocket();
    const { startCall, callStatus, activeCallContext } = useVideoCall();
    const [tickets, setTickets] = useState([]);
    const [loading, setLoading] = useState(true);
    const [activeTicketId, setActiveTicketId] = useState(null);
    const [messages, setMessages] = useState([]);
    const [messagesLoading, setMessagesLoading] = useState(false);
    const [newMessage, setNewMessage] = useState('');
    const [sending, setSending] = useState(false);
    const [error, setError] = useState('');
    const [statusFilter, setStatusFilter] = useState('');
    const [statusDraft, setStatusDraft] = useState('open');
    const [resolutionDraft, setResolutionDraft] = useState('');
    const [userActionRequiredDraft, setUserActionRequiredDraft] = useState(false);
    const [updatingStatus, setUpdatingStatus] = useState(false);
    const [startingLiveCall, setStartingLiveCall] = useState(false);

    const messagesEndRef = useRef(null);

    const fetchTickets = useCallback(async ({ silent = false } = {}) => {
        try {
            if (!silent) {
                setLoading(true);
            }

            const params = {};
            if (statusFilter) params.status = statusFilter;
            const res = await supportApi.adminGetTickets(params);
            const nextTickets = sortTickets(Array.isArray(res.data) ? res.data.map(normalizeTicket) : []);

            setTickets(nextTickets);
            setActiveTicketId((prev) => {
                if (prev && nextTickets.some((ticket) => String(ticket._id) === String(prev))) {
                    return prev;
                }
                return nextTickets[0]?._id || null;
            });
            setError('');
        } catch (err) {
            setError(err.message || 'Failed to load tickets');
        } finally {
            if (!silent) {
                setLoading(false);
            }
        }
    }, [statusFilter]);

    const fetchMessages = useCallback(async (ticketId, { silent = false } = {}) => {
        if (!ticketId) {
            setMessages([]);
            return;
        }

        try {
            if (!silent) {
                setMessagesLoading(true);
            }

            const res = await supportApi.getMessages(ticketId);
            setMessages(Array.isArray(res.data) ? res.data : []);
            setTickets((prev) => prev.map((ticket) => (
                String(ticket._id) === String(ticketId)
                    ? { ...ticket, unreadByAdmin: 0 }
                    : ticket
            )));
            setError('');
        } catch (err) {
            setError(err.message || 'Failed to load messages');
        } finally {
            if (!silent) {
                setMessagesLoading(false);
            }
        }
    }, []);

    useEffect(() => {
        fetchTickets();
    }, [fetchTickets]);

    useEffect(() => {
        if (activeTicketId) {
            fetchMessages(activeTicketId);
            return;
        }

        setMessages([]);
    }, [activeTicketId, fetchMessages]);

    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'auto' });
    }, [messages]);

    useEffect(() => {
        const activeTicket = tickets.find((ticket) => String(ticket._id) === String(activeTicketId));
        if (!activeTicket) return;

        setStatusDraft(String(activeTicket.status || 'open'));
        setResolutionDraft(String(activeTicket.resolutionSummary || ''));
        setUserActionRequiredDraft(Boolean(activeTicket.userActionRequired));
    }, [activeTicketId, tickets]);

    useEffect(() => {
        if (isConnected) return undefined;

        const ticketTimer = window.setInterval(() => {
            fetchTickets({ silent: true });
        }, TICKET_LIST_POLL_MS);

        return () => window.clearInterval(ticketTimer);
    }, [fetchTickets, isConnected]);

    useEffect(() => {
        if (isConnected || !activeTicketId) return undefined;

        const messageTimer = window.setInterval(() => {
            fetchMessages(activeTicketId, { silent: true });
        }, ACTIVE_TICKET_POLL_MS);

        return () => window.clearInterval(messageTimer);
    }, [activeTicketId, fetchMessages, isConnected]);

    useEffect(() => {
        if (!socket) return undefined;

        const handleTicketNew = (payload = {}) => {
            const ticket = normalizeTicket(payload.ticket);
            if (!ticket?._id) return;

            setTickets((prev) => upsertTicket(prev, ticket, statusFilter));
            setActiveTicketId((prev) => prev || ticket._id);
        };

        const handleTicketUpdate = (payload = {}) => {
            const ticket = normalizeTicket(payload.ticket);
            if (!ticket?._id) return;

            setTickets((prev) => upsertTicket(prev, ticket, statusFilter));
        };

        const handleMessageNew = (payload = {}) => {
            const { ticketId, message } = payload;
            const isActiveTicket = String(ticketId || '') === String(activeTicketId || '');

            if (payload.ticket) {
                const nextTicket = isActiveTicket
                    ? { ...payload.ticket, unreadByAdmin: 0 }
                    : payload.ticket;
                setTickets((prev) => upsertTicket(prev, nextTicket, statusFilter));
            }

            if (!isActiveTicket) return;

            setMessages((prev) => appendUniqueMessage(prev, message));
            void fetchMessages(ticketId, { silent: true });
        };

        socket.on('support:ticket:new', handleTicketNew);
        socket.on('support:ticket:update', handleTicketUpdate);
        socket.on('support:message:new', handleMessageNew);

        return () => {
            socket.off('support:ticket:new', handleTicketNew);
            socket.off('support:ticket:update', handleTicketUpdate);
            socket.off('support:message:new', handleMessageNew);
        };
    }, [activeTicketId, fetchMessages, socket, statusFilter]);

    const handleSendMessage = async (event) => {
        event.preventDefault();
        if (!newMessage.trim() || sending || !activeTicketId) return;

        const tempText = newMessage;
        setNewMessage('');

        try {
            setSending(true);
            const res = await supportApi.sendMessage(activeTicketId, tempText);
            const nextMessage = res.data;
            setMessages((prev) => appendUniqueMessage(prev, nextMessage));
            setTickets((prev) => prev.map((ticket) => (
                String(ticket._id) === String(activeTicketId)
                    ? {
                        ...ticket,
                        lastMessagePreview: String(tempText).slice(0, 150),
                        lastMessageAt: nextMessage?.sentAt || nextMessage?.createdAt || new Date().toISOString(),
                        unreadByAdmin: 0,
                    }
                    : ticket
            )));
            setError('');
        } catch (err) {
            setError(err.message || 'Failed to send message');
            setNewMessage(tempText);
        } finally {
            setSending(false);
            setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 100);
        }
    };

    const handleUpdateStatus = async () => {
        if (!activeTicketId) return;

        try {
            setUpdatingStatus(true);
            const res = await supportApi.adminUpdateStatus(activeTicketId, {
                status: statusDraft,
                resolutionSummary: resolutionDraft.trim(),
                userActionRequired: userActionRequiredDraft,
            });
            const nextTicket = normalizeTicket(res?.data);
            if (nextTicket?._id) {
                setTickets((prev) => upsertTicket(prev, nextTicket, statusFilter));
            }
            await fetchMessages(activeTicketId, { silent: true });
            setError('');
        } catch (err) {
            setError(err.message || 'Failed to update status');
        } finally {
            setUpdatingStatus(false);
        }
    };

    const activeTicket = tickets.find((ticket) => String(ticket._id) === String(activeTicketId));
    const isActiveSupportCall = activeCallContext?.channelType === 'support_ticket'
        && String(activeCallContext?.contextId || '') === String(activeTicketId || '')
        && ['calling', 'incoming', 'connected'].includes(callStatus);

    const handleStartLiveCall = async () => {
        if (!activeTicket?._id || !activeTicket?.user?._id || startingLiveCall) return;

        try {
            setStartingLiveCall(true);
            const started = await startCall({
                targetUserId: activeTicket.user._id,
                channelType: 'support_ticket',
                contextId: activeTicket._id,
                supportTicketId: activeTicket._id,
                contextLabel: `Aura Support live call for "${activeTicket.subject}"`,
            });
            if (!started) {
                setError('Failed to start the live support call');
            }
        } finally {
            setStartingLiveCall(false);
        }
    };

    const getStatusBadge = (status) => {
        switch (status) {
            case 'open':
                return <span className="inline-flex items-center gap-1 rounded border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-xs font-bold text-amber-500"><Clock className="h-3 w-3" /> Open</span>;
            case 'resolved':
                return <span className="inline-flex items-center gap-1 rounded border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-xs font-bold text-emerald-500"><CheckCircle className="h-3 w-3" /> Resolved</span>;
            case 'closed':
                return <span className="inline-flex items-center gap-1 rounded border border-zinc-500/30 bg-zinc-500/10 px-2 py-0.5 text-xs font-bold text-zinc-500"><X className="h-3 w-3" /> Closed</span>;
            default:
                return null;
        }
    };

    return (
        <AdminPremiumShell
            eyebrow="Customer Service"
            title="Support & Appeals"
            description="Manage moderation appeals and support tickets with live admin updates, resilient polling fallback, and direct conversation control."
            actions={(
                <div className="flex flex-wrap gap-3">
                    <div className={cn(
                        'inline-flex items-center gap-2 rounded-full border px-3 py-2 text-xs font-semibold',
                        isConnected
                            ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                            : 'border-amber-200 bg-amber-50 text-amber-700'
                    )}>
                        {isConnected ? <Wifi className="h-3.5 w-3.5" /> : <WifiOff className="h-3.5 w-3.5" />}
                        {isConnected ? 'Live socket' : 'Polling fallback'}
                    </div>
                    <PremiumSelect value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="w-[150px]">
                        <option value="">All Tickets</option>
                        <option value="open">Open</option>
                        <option value="resolved">Resolved</option>
                        <option value="closed">Closed</option>
                    </PremiumSelect>
                    <button type="button" onClick={() => fetchTickets()} className="admin-premium-button">
                        <RefreshCw className="h-4 w-4" />
                        Refresh
                    </button>
                </div>
            )}
        >
            <div className="flex h-[700px] flex-col gap-6 xl:flex-row">
                <div className="flex w-full flex-col overflow-hidden admin-premium-panel p-0 xl:w-1/3">
                    {error ? <div className="m-3 rounded bg-red-50 p-3 text-sm font-medium text-red-600">{error}</div> : null}

                    <div className="relative flex-1 space-y-1 overflow-y-auto p-2 scrollbar-hide">
                        {loading ? (
                            <div className="p-6 text-center text-sm text-slate-500">Loading tickets...</div>
                        ) : tickets.length === 0 ? (
                            <div className="p-6 text-center text-sm text-slate-500">No support tickets found</div>
                        ) : (
                            tickets.map((ticket) => (
                                <button
                                    key={ticket._id}
                                    type="button"
                                    onClick={() => setActiveTicketId(ticket._id)}
                                    className={cn(
                                        'w-full rounded-xl border p-4 text-left transition-all',
                                        activeTicketId === ticket._id
                                            ? 'border-indigo-200 bg-indigo-50'
                                            : 'border-transparent bg-white hover:bg-slate-50'
                                    )}
                                >
                                    <div className="mb-1 flex items-start justify-between">
                                        <div className="truncate pr-2 font-bold text-slate-900" title={ticket.subject}>{ticket.subject}</div>
                                        {getStatusBadge(ticket.status)}
                                    </div>
                                    <div className="mb-2 flex items-center gap-2 truncate font-mono text-xs text-slate-500">
                                        <span className="rounded bg-slate-100 px-1.5 py-0.5">{ticket.category}</span>
                                        <span className="truncate">{ticket.user?.email}</span>
                                    </div>
                                    <div className="truncate text-sm text-slate-600">
                                        {ticket.lastMessagePreview || 'No messages'}
                                    </div>
                                    <div className="mt-3 flex items-center justify-between">
                                        <div className="font-mono text-[10px] text-slate-400">ID: {String(ticket._id).slice(-6)}</div>
                                        {ticket.unreadByAdmin > 0 ? (
                                            <div className="rounded-full bg-rose-500 px-2 py-0.5 text-[10px] font-bold text-white shadow-sm">
                                                {ticket.unreadByAdmin} NEW
                                            </div>
                                        ) : null}
                                    </div>
                                </button>
                            ))
                        )}
                    </div>
                </div>

                <div className="relative flex flex-1 flex-col overflow-hidden admin-premium-panel p-0">
                    {!activeTicketId ? (
                        <div className="flex flex-1 flex-col items-center justify-center text-slate-400">
                            <MessageSquare className="mb-4 h-16 w-16 opacity-20" />
                            <p className="font-medium text-slate-500">Select a ticket to view conversation</p>
                        </div>
                    ) : activeTicket ? (
                        <>
                            <div className="border-b border-slate-200 bg-slate-50 p-4">
                                <div className="flex items-start justify-between gap-4">
                                    <div className="min-w-0 flex-1 pr-4">
                                    <h3 className="truncate text-lg font-bold text-slate-900">{activeTicket.subject}</h3>
                                    <div className="mt-1 flex items-center gap-3 font-mono text-xs text-slate-500">
                                        <span>User: {activeTicket.user?.email || activeTicket.user?.name}</span>
                                        <span>•</span>
                                        <span className={cn(
                                            activeTicket.user?.accountState === 'suspended'
                                                ? 'font-bold text-rose-600'
                                                : 'font-bold text-emerald-600'
                                        )}>
                                            [{activeTicket.user?.accountState}]
                                        </span>
                                    </div>
                                    <div className="mt-3 flex flex-wrap items-center gap-2 text-[10px] font-black uppercase tracking-[0.18em]">
                                        <span className="rounded-full border border-slate-300 bg-slate-100 px-2 py-0.5 text-slate-600">
                                            {activeTicket.category}
                                        </span>
                                        <span className={cn(
                                            'rounded-full border px-2 py-0.5',
                                            activeTicket.priority === 'urgent'
                                                ? 'border-rose-200 bg-rose-50 text-rose-600'
                                                : activeTicket.priority === 'high'
                                                    ? 'border-amber-200 bg-amber-50 text-amber-700'
                                                    : 'border-cyan-200 bg-cyan-50 text-cyan-700'
                                        )}>
                                            {activeTicket.priority}
                                        </span>
                                        {activeTicket.userActionRequired ? (
                                            <span className="rounded-full border border-rose-200 bg-rose-50 px-2 py-0.5 text-rose-600">
                                                user action required
                                            </span>
                                        ) : null}
                                        {activeTicket.liveCallRequested ? (
                                            <span className="rounded-full border border-cyan-200 bg-cyan-50 px-2 py-0.5 text-cyan-700">
                                                live call requested
                                            </span>
                                        ) : null}
                                        {activeTicket.liveCallLastStatus === 'connected' || isActiveSupportCall ? (
                                            <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-emerald-700">
                                                live call active
                                            </span>
                                        ) : null}
                                    </div>
                                </div>
                                    <div className="flex shrink-0 items-center gap-2">
                                        {getStatusBadge(activeTicket.status)}
                                        <button
                                            type="button"
                                            onClick={handleStartLiveCall}
                                            disabled={startingLiveCall || activeTicket.status === 'closed' || !activeTicket.user?._id || isActiveSupportCall}
                                            className="admin-premium-button"
                                        >
                                            {startingLiveCall ? <RefreshCw className="h-4 w-4 animate-spin" /> : <PhoneCall className="h-4 w-4" />}
                                            {isActiveSupportCall ? 'Live now' : 'Start live call'}
                                        </button>
                                    </div>
                                </div>
                                {activeTicket.resolutionSummary ? (
                                    <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700">
                                        <div className="mb-1 text-xs font-black uppercase tracking-[0.18em] text-emerald-600">Current resolution summary</div>
                                        <div>{activeTicket.resolutionSummary}</div>
                                    </div>
                                ) : null}

                                <div className={cn(
                                    'mt-4 rounded-2xl border p-4 text-sm',
                                    isActiveSupportCall || activeTicket.liveCallLastStatus === 'connected'
                                        ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                                        : activeTicket.liveCallRequested
                                            ? 'border-cyan-200 bg-cyan-50 text-cyan-700'
                                            : 'border-slate-200 bg-white text-slate-600'
                                )}>
                                    <div className="flex items-center justify-between gap-3">
                                        <div>
                                            <div className="text-xs font-black uppercase tracking-[0.18em] text-slate-500">Live support lane</div>
                                            <div className="mt-2 font-semibold text-slate-900">
                                                {isActiveSupportCall
                                                    ? 'A live support call is ringing or connected on this ticket.'
                                                    : activeTicket.liveCallRequested
                                                        ? 'Customer requested real-time support. Start the call when ready.'
                                                        : activeTicket.liveCallLastStatus === 'ended' || activeTicket.liveCallLastStatus === 'missed'
                                                            ? 'The last live call finished. Start another one if real-time handling is still needed.'
                                                            : 'Escalate this ticket into a real-time video call when text support is too slow.'}
                                            </div>
                                        </div>
                                        <div className="text-right text-xs text-slate-500">
                                            {activeTicket.liveCallRequestedAt ? (
                                                <div>Requested {new Date(activeTicket.liveCallRequestedAt).toLocaleString()}</div>
                                            ) : activeTicket.liveCallEndedAt ? (
                                                <div>Last ended {new Date(activeTicket.liveCallEndedAt).toLocaleString()}</div>
                                            ) : (
                                                <div>No live call yet</div>
                                            )}
                                        </div>
                                    </div>
                                </div>

                                <div className="mt-4 grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 lg:grid-cols-[140px_minmax(0,1fr)_auto]">
                                    <PremiumSelect
                                        value={statusDraft}
                                        onChange={(e) => setStatusDraft(e.target.value)}
                                        className="w-full text-xs font-bold"
                                    >
                                        <option value="open">Open</option>
                                        <option value="resolved">Resolved</option>
                                        <option value="closed">Closed</option>
                                    </PremiumSelect>
                                    <textarea
                                        value={resolutionDraft}
                                        onChange={(e) => setResolutionDraft(e.target.value)}
                                        rows={2}
                                        maxLength={800}
                                        placeholder="Add the resolution, policy note, or next step the user should actually see."
                                        className="min-h-[84px] rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-900 outline-none transition-colors focus:border-indigo-300"
                                    />
                                    <div className="flex flex-col justify-between gap-3">
                                        <label className="flex items-start gap-2 text-sm text-slate-600">
                                            <input
                                                type="checkbox"
                                                checked={userActionRequiredDraft}
                                                onChange={(e) => setUserActionRequiredDraft(e.target.checked)}
                                                className="mt-1"
                                            />
                                            <span>User action required</span>
                                        </label>
                                        <button
                                            type="button"
                                            onClick={handleUpdateStatus}
                                            disabled={updatingStatus}
                                            className="admin-premium-button justify-center"
                                        >
                                            {updatingStatus ? <RefreshCw className="h-4 w-4 animate-spin" /> : <CheckCircle className="h-4 w-4" />}
                                            Apply update
                                        </button>
                                    </div>
                                </div>
                            </div>

                            <div className="flex-1 space-y-6 overflow-y-auto bg-slate-50/50 p-6 scrollbar-hide">
                                {messagesLoading ? (
                                    <div className="mt-10 text-center text-slate-400">Loading chat history...</div>
                                ) : (
                                    messages.map((message, index) => {
                                        const isAdmin = message.isAdmin;
                                        const sentAt = message?.sentAt || message?.createdAt;

                                        if (message.isSystem) {
                                            return (
                                                <div key={message._id || index} className="my-4 flex justify-center">
                                                    <div className="flex items-center gap-2 rounded-full border border-slate-300 bg-slate-200/50 px-4 py-1.5 text-xs font-medium text-slate-600">
                                                        <AlertCircle className="h-3 w-3" /> {message.text}
                                                    </div>
                                                </div>
                                            );
                                        }

                                        return (
                                            <div key={message._id || index} className={cn('flex', isAdmin ? 'justify-end' : 'justify-start')}>
                                                <div className={cn(
                                                    'max-w-[85%] rounded-2xl p-4 shadow-sm',
                                                    isAdmin
                                                        ? 'rounded-tr-sm bg-indigo-600 text-white'
                                                        : 'rounded-tl-sm border border-slate-200 bg-white text-slate-900'
                                                )}>
                                                    {!isAdmin ? (
                                                        <div className="mb-2 flex items-center gap-2">
                                                            <div className="flex h-5 w-5 items-center justify-center rounded-full bg-slate-200 text-[10px] font-bold text-slate-600">
                                                                {(message.sender?.name || 'U')[0].toUpperCase()}
                                                            </div>
                                                            <span className="text-xs font-bold tracking-wide text-slate-500">
                                                                {message.sender?.name || message.sender?.email || 'User'}
                                                            </span>
                                                        </div>
                                                    ) : (
                                                        <div className="mb-2 flex items-center justify-end gap-2">
                                                            <span className="text-xs font-bold uppercase tracking-wider text-indigo-200">Staff Reply</span>
                                                            <ShieldAlert className="h-3.5 w-3.5 text-indigo-300" />
                                                        </div>
                                                    )}
                                                    <div className="whitespace-pre-wrap text-[15px] leading-relaxed">{message.text}</div>
                                                    <div className={cn(
                                                        'mt-2 text-right text-[10px] font-medium opacity-70',
                                                        isAdmin ? 'text-indigo-200' : 'text-slate-400'
                                                    )}>
                                                        {sentAt ? new Date(sentAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''}
                                                    </div>
                                                </div>
                                            </div>
                                        );
                                    })
                                )}
                                <div ref={messagesEndRef} />
                            </div>

                            {activeTicket.status !== 'closed' ? (
                                <form onSubmit={handleSendMessage} className="border-t border-slate-200 bg-white p-4">
                                    <div className="relative flex gap-3">
                                        <input
                                            type="text"
                                            value={newMessage}
                                            onChange={(e) => setNewMessage(e.target.value)}
                                            placeholder="Type your official response..."
                                            className="flex-1 rounded-xl border-none bg-slate-100 px-4 py-3.5 pr-14 font-medium text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                                        />
                                        <button
                                            type="submit"
                                            disabled={!newMessage.trim() || sending}
                                            className="absolute bottom-2 right-2 top-2 aspect-square rounded-lg bg-indigo-600 text-white shadow-sm transition-colors hover:bg-indigo-700 disabled:opacity-50"
                                        >
                                            <Send className="ml-0.5 h-4 w-4" />
                                        </button>
                                    </div>
                                </form>
                            ) : (
                                <div className="border-t border-slate-200 bg-slate-100 p-4 text-center text-sm font-medium text-slate-500">
                                    This ticket is closed. Reopen it to send a new message.
                                </div>
                            )}
                        </>
                    ) : null}
                </div>
            </div>
        </AdminPremiumShell>
    );
}

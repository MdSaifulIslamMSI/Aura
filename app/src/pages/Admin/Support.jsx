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

const STICKY_SCROLL_THRESHOLD_PX = 64;

const buildMessagesSignature = (messages = []) => messages.map((message) => (
    `${message?._id || message?.sentAt || message?.createdAt || ''}:${message?.text || ''}`
)).join('|');

const isNearBottom = (element) => {
    if (!element) return true;
    return (element.scrollHeight - element.scrollTop - element.clientHeight) <= STICKY_SCROLL_THRESHOLD_PX;
};

const isValidDateValue = (value) => {
    const date = new Date(value || 0);
    return !Number.isNaN(date.getTime());
};

const getDayKey = (value) => {
    if (!isValidDateValue(value)) return '';
    const date = new Date(value);
    return [date.getFullYear(), date.getMonth(), date.getDate()].join('-');
};

const getInitials = (value = '') => {
    const parts = String(value || '')
        .trim()
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 2);

    if (parts.length === 0) return 'AU';
    return parts.map((part) => part[0]?.toUpperCase() || '').join('');
};

const formatThreadPreviewTime = (value) => {
    if (!isValidDateValue(value)) return 'Now';

    const date = new Date(value);
    const today = new Date();
    const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
    const startOfDate = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
    const diffDays = Math.round((startOfToday - startOfDate) / 86400000);

    if (diffDays === 0) {
        return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }

    if (diffDays === 1) {
        return 'Yesterday';
    }

    if (diffDays > 1 && diffDays < 7) {
        return date.toLocaleDateString([], { weekday: 'short' });
    }

    return date.toLocaleDateString([], { day: 'numeric', month: 'short' });
};

const formatMessageDayLabel = (value) => {
    if (!isValidDateValue(value)) return 'Today';

    const date = new Date(value);
    const today = new Date();
    const yesterday = new Date();
    yesterday.setDate(today.getDate() - 1);

    if (date.toDateString() === today.toDateString()) {
        return 'Today';
    }

    if (date.toDateString() === yesterday.toDateString()) {
        return 'Yesterday';
    }

    const includeYear = date.getFullYear() !== today.getFullYear();
    return date.toLocaleDateString([], {
        day: 'numeric',
        month: 'short',
        ...(includeYear ? { year: 'numeric' } : {}),
    });
};

const formatMessageTime = (value) => {
    if (!isValidDateValue(value)) return '';
    return new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
};

export default function AdminSupport() {
    useSocketDemand('admin-support', true);
    const { socket, isConnected } = useSocket();
    const { startCall, joinSupportCall, callStatus, activeCallContext } = useVideoCall();
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
    const messagesContainerRef = useRef(null);
    const shouldStickToBottomRef = useRef(true);
    const pendingScrollBehaviorRef = useRef('auto');
    const messageSignatureRef = useRef('');

    const handleMessagesScroll = () => {
        shouldStickToBottomRef.current = isNearBottom(messagesContainerRef.current);
    };

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
            shouldStickToBottomRef.current = true;
            pendingScrollBehaviorRef.current = 'auto';
            fetchMessages(activeTicketId);
            return;
        }

        messageSignatureRef.current = '';
        pendingScrollBehaviorRef.current = '';
        setMessages([]);
    }, [activeTicketId, fetchMessages]);

    useEffect(() => {
        const nextSignature = buildMessagesSignature(messages);
        const signatureChanged = nextSignature !== messageSignatureRef.current;
        const requestedBehavior = pendingScrollBehaviorRef.current;

        if (!signatureChanged && !requestedBehavior) {
            return;
        }

        messageSignatureRef.current = nextSignature;

        if (!requestedBehavior && !shouldStickToBottomRef.current) {
            return;
        }

        pendingScrollBehaviorRef.current = '';
        messagesEndRef.current?.scrollIntoView({
            behavior: requestedBehavior || 'auto',
            block: 'end',
        });
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
            shouldStickToBottomRef.current = true;
            pendingScrollBehaviorRef.current = 'smooth';
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
    const canJoinSupportCall = Boolean(
        activeTicket?._id
        && activeTicket.liveCallLastSessionKey
        && ['ringing', 'connected'].includes(String(activeTicket.liveCallLastStatus || ''))
        && !isActiveSupportCall
    );

    const handleStartLiveCall = async () => {
        if (!activeTicket?._id || !activeTicket?.user?._id || startingLiveCall) return;

        try {
            setStartingLiveCall(true);
            const liveCallAction = canJoinSupportCall
                ? await joinSupportCall({
                    channelType: 'support_ticket',
                    contextId: activeTicket._id,
                    supportTicketId: activeTicket._id,
                    contextLabel: activeTicket.liveCallLastContextLabel || `Aura Support live call for "${activeTicket.subject}"`,
                    sessionKey: activeTicket.liveCallLastSessionKey,
                    callerName: 'Aura Support',
                })
                : await startCall({
                    targetUserId: activeTicket.user._id,
                    channelType: 'support_ticket',
                    contextId: activeTicket._id,
                    supportTicketId: activeTicket._id,
                    contextLabel: `Aura Support live call for "${activeTicket.subject}"`,
                });
            if (!liveCallAction) {
                setError(canJoinSupportCall ? 'Failed to join the live support call' : 'Failed to start the live support call');
            }
        } finally {
            setStartingLiveCall(false);
        }
    };

    const liveCallActionLabel = isActiveSupportCall
        ? 'Live now'
        : canJoinSupportCall
            ? 'Join live call'
            : 'Start live call';
    const liveCallStatusCopy = isActiveSupportCall
        ? 'A live support call is already ringing or connected on this ticket.'
        : !isConnected
            ? 'Ticket updates are on polling fallback, but the live call itself can still run over LiveKit.'
            : activeTicket?.liveCallRequested
                ? 'The customer requested real-time support. Start the call when you are ready.'
                : canJoinSupportCall
                    ? 'A live support session is already open for this ticket. Rejoin it from here.'
                    : activeTicket?.liveCallLastStatus === 'ended' || activeTicket?.liveCallLastStatus === 'missed'
                        ? 'The last live call finished. Start another one if real-time handling is still needed.'
                        : 'Escalate this ticket into a real-time video call when text support is too slow.';
    const liveCallStatusTime = activeTicket?.liveCallRequestedAt
        ? `Requested ${new Date(activeTicket.liveCallRequestedAt).toLocaleString()}`
        : activeTicket?.liveCallEndedAt
            ? `Last ended ${new Date(activeTicket.liveCallEndedAt).toLocaleString()}`
            : 'No live call yet';

    const getStatusBadge = (status) => {
        switch (status) {
            case 'open':
                return <span className="inline-flex items-center gap-1 rounded-full border border-amber-300/20 bg-amber-500/12 px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.18em] text-amber-100"><Clock className="h-3 w-3" /> Open</span>;
            case 'resolved':
                return <span className="inline-flex items-center gap-1 rounded-full border border-emerald-300/20 bg-emerald-500/12 px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.18em] text-emerald-100"><CheckCircle className="h-3 w-3" /> Resolved</span>;
            case 'closed':
                return <span className="inline-flex items-center gap-1 rounded-full border border-slate-400/20 bg-slate-500/10 px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.18em] text-slate-300"><X className="h-3 w-3" /> Closed</span>;
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
                            ? 'border-emerald-300/20 bg-emerald-500/12 text-emerald-100'
                            : 'border-amber-300/20 bg-amber-500/12 text-amber-100'
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
            <div className="grid min-h-[700px] gap-6 xl:grid-cols-[24rem_minmax(0,1fr)]">
                <div className="flex w-full flex-col overflow-hidden admin-premium-panel p-0">
                    <div className="border-b border-white/10 px-5 py-5">
                        <p className="text-[11px] font-black uppercase tracking-[0.28em] text-emerald-200">Support desk</p>
                        <h3 className="mt-2 text-2xl font-black text-white">Customer chat queue</h3>
                        <p className="mt-1.5 text-sm text-slate-400">
                            Ticket handling, resolution notes, and live support now move like a shared messaging tool.
                        </p>

                        {error ? (
                            <div className="mt-4 rounded-[1.25rem] border border-rose-400/20 bg-rose-500/12 p-3 text-sm font-medium text-rose-100">
                                {error}
                            </div>
                        ) : null}
                    </div>

                    <div className="relative flex-1 space-y-3 overflow-y-auto p-3 scrollbar-hide">
                        {loading ? (
                            <div className="p-6 text-center text-sm text-slate-400">Loading tickets...</div>
                        ) : tickets.length === 0 ? (
                            <div className="flex h-full flex-col items-center justify-center p-6 text-center">
                                <div className="support-chat-avatar h-16 w-16 text-emerald-100">
                                    <MessageSquare className="h-8 w-8" />
                                </div>
                                <div className="mt-5 text-lg font-black text-white">No tickets found</div>
                                <p className="mt-2 max-w-xs text-sm text-slate-400">
                                    When customers need help, their threads will appear here in queue order.
                                </p>
                            </div>
                        ) : (
                            tickets.map((ticket) => (
                                <button
                                    key={ticket._id}
                                    type="button"
                                    onClick={() => setActiveTicketId(ticket._id)}
                                    className={cn(
                                        'support-chat-card w-full p-4 text-left transition-all',
                                        activeTicketId === ticket._id ? 'support-chat-card-active' : ''
                                    )}
                                >
                                    <div className="flex items-start gap-3">
                                        <div className="support-chat-avatar h-12 w-12 shrink-0 text-sm font-black">
                                            {getInitials(ticket.user?.name || ticket.user?.email || ticket.subject)}
                                        </div>

                                        <div className="min-w-0 flex-1">
                                            <div className="flex items-start justify-between gap-3">
                                                <div className="min-w-0">
                                                    <div className="truncate text-sm font-black text-white" title={ticket.subject}>{ticket.subject}</div>
                                                    <div className="mt-1 truncate text-[11px] font-medium text-slate-400">
                                                        {ticket.user?.email || ticket.user?.name || 'Unknown user'}
                                                    </div>
                                                </div>
                                                <span className="shrink-0 text-[11px] font-medium text-slate-400">
                                                    {formatThreadPreviewTime(ticket.lastMessageAt || ticket.updatedAt || ticket.createdAt)}
                                                </span>
                                            </div>

                                            <div className="mt-3 line-clamp-2 text-sm leading-6 text-slate-300">
                                                {ticket.lastMessagePreview || 'No messages yet.'}
                                            </div>

                                            <div className="mt-3 flex items-center justify-between gap-3">
                                                <div className="flex flex-wrap items-center gap-2">
                                                    <span className="rounded-full border border-white/10 bg-white/[0.05] px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.18em] text-slate-200">
                                                        {ticket.category}
                                                    </span>
                                                    <span className={cn(
                                                        'rounded-full border px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.18em]',
                                                        ticket.priority === 'urgent'
                                                            ? 'border-rose-300/20 bg-rose-500/12 text-rose-100'
                                                            : ticket.priority === 'high'
                                                                ? 'border-amber-300/20 bg-amber-500/12 text-amber-100'
                                                                : 'border-cyan-300/20 bg-cyan-500/12 text-cyan-100'
                                                    )}>
                                                        {ticket.priority}
                                                    </span>
                                                </div>

                                                <div className="flex shrink-0 items-center gap-2">
                                                    {ticket.unreadByAdmin > 0 ? (
                                                        <span className="rounded-full bg-emerald-400 px-2.5 py-1 text-[10px] font-black text-[#032114]">
                                                            {ticket.unreadByAdmin}
                                                        </span>
                                                    ) : null}
                                                    {getStatusBadge(ticket.status)}
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                </button>
                            ))
                        )}
                    </div>
                </div>

                <div className="relative flex flex-1 flex-col overflow-hidden admin-premium-panel p-0">
                    {!activeTicketId ? (
                        <div className="support-chat-thread flex flex-1 flex-col items-center justify-center px-6 text-center text-slate-300">
                            <div className="support-chat-avatar h-20 w-20 text-emerald-100">
                                <MessageSquare className="h-10 w-10" />
                            </div>
                            <h4 className="mt-5 text-2xl font-black text-white">Select a customer thread</h4>
                            <p className="mt-3 max-w-xl text-sm leading-7 text-slate-300">
                                Open any ticket on the left to jump into the conversation, update the resolution state, or escalate to live support.
                            </p>
                        </div>
                    ) : activeTicket ? (
                        <>
                            <div className="border-b border-white/10 px-5 py-5">
                                <div className="flex items-start justify-between gap-4">
                                    <div className="flex min-w-0 flex-1 items-start gap-4 pr-4">
                                        <div className="support-chat-avatar h-14 w-14 shrink-0 text-base font-black">
                                            {getInitials(activeTicket.user?.name || activeTicket.user?.email || activeTicket.subject)}
                                        </div>
                                        <div className="min-w-0 flex-1">
                                    <h3 className="truncate text-2xl font-black text-white">{activeTicket.subject}</h3>
                                    <div className="mt-1 flex flex-wrap items-center gap-2 font-mono text-xs text-slate-400">
                                        <span>{activeTicket.user?.email || activeTicket.user?.name || 'Unknown user'}</span>
                                        <span>|</span>
                                        <span className={cn(
                                            activeTicket.user?.accountState === 'suspended'
                                                ? 'font-bold text-rose-300'
                                                : 'font-bold text-emerald-300'
                                        )}>
                                            {activeTicket.user?.accountState || 'active'}
                                        </span>
                                    </div>
                                    <div className="mt-3 flex flex-wrap items-center gap-2 text-[10px] font-black uppercase tracking-[0.18em]">
                                        <span className="rounded-full border border-white/10 bg-white/[0.06] px-2 py-0.5 text-slate-200">
                                            {activeTicket.category}
                                        </span>
                                        <span className={cn(
                                            'rounded-full border px-2 py-0.5',
                                            activeTicket.priority === 'urgent'
                                                ? 'border-rose-300/20 bg-rose-500/12 text-rose-100'
                                                : activeTicket.priority === 'high'
                                                    ? 'border-amber-300/20 bg-amber-500/12 text-amber-100'
                                                    : 'border-cyan-300/20 bg-cyan-500/12 text-cyan-100'
                                        )}>
                                            {activeTicket.priority}
                                        </span>
                                        {activeTicket.userActionRequired ? (
                                            <span className="rounded-full border border-rose-300/20 bg-rose-500/12 px-2 py-0.5 text-rose-100">
                                                user action required
                                            </span>
                                        ) : null}
                                        {activeTicket.liveCallRequested ? (
                                            <span className="rounded-full border border-cyan-300/20 bg-cyan-500/12 px-2 py-0.5 text-cyan-100">
                                                live call requested
                                            </span>
                                        ) : null}
                                        {activeTicket.liveCallLastStatus === 'connected' || isActiveSupportCall ? (
                                            <span className="rounded-full border border-emerald-300/20 bg-emerald-500/12 px-2 py-0.5 text-emerald-100">
                                                live call active
                                            </span>
                                        ) : null}
                                    </div>
                                        </div>
                                    </div>
                                    <div className="flex shrink-0 items-center gap-2">
                                        {getStatusBadge(activeTicket.status)}
                                        <button
                                            type="button"
                                            onClick={handleStartLiveCall}
                                            disabled={startingLiveCall || activeTicket.status === 'closed' || !activeTicket.user?._id || isActiveSupportCall}
                                            className="support-chat-send inline-flex items-center gap-2 px-4 py-2.5 text-sm font-black disabled:cursor-not-allowed"
                                        >
                                            {startingLiveCall ? <RefreshCw className="h-4 w-4 animate-spin" /> : <PhoneCall className="h-4 w-4" />}
                                            {liveCallActionLabel}
                                        </button>
                                    </div>
                                </div>
                                {activeTicket.resolutionSummary ? (
                                    <div className="mt-4 rounded-[1.5rem] border border-emerald-300/20 bg-emerald-500/12 p-4 text-sm text-emerald-100">
                                        <div className="mb-1 text-xs font-black uppercase tracking-[0.18em] text-emerald-200">Current resolution summary</div>
                                        <div className="leading-6">{activeTicket.resolutionSummary}</div>
                                    </div>
                                ) : null}

                                <div className={cn(
                                    'mt-4 rounded-[1.6rem] border p-4 text-sm',
                                    isActiveSupportCall || activeTicket.liveCallLastStatus === 'connected'
                                        ? 'border-emerald-300/20 bg-emerald-500/12 text-emerald-100'
                                        : activeTicket.liveCallRequested
                                            ? 'border-cyan-300/20 bg-cyan-500/12 text-cyan-100'
                                            : 'border-white/10 bg-white/[0.04] text-slate-200'
                                )}>
                                    <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                                        <div className="min-w-0 flex-1">
                                            <div className="text-xs font-black uppercase tracking-[0.18em] text-slate-400">Live support lane</div>
                                            <div className="mt-2 font-semibold leading-6 text-white">
                                                {liveCallStatusCopy}
                                            </div>
                                        </div>
                                        <div className="text-right text-xs text-slate-400">
                                            <div>{liveCallStatusTime}</div>
                                        </div>
                                    </div>
                                </div>

                                <div className="mt-4 grid gap-3 rounded-[1.7rem] border border-white/10 bg-white/[0.04] p-4 lg:grid-cols-[150px_minmax(0,1fr)_auto]">
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
                                        className="admin-premium-control min-h-[84px] resize-none px-3 py-2"
                                    />
                                    <div className="flex flex-col justify-between gap-3">
                                        <label className="flex items-start gap-2 text-sm text-slate-300">
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
                                            className="support-chat-utility justify-center px-4 py-3 text-sm font-black"
                                        >
                                            {updatingStatus ? <RefreshCw className="h-4 w-4 animate-spin" /> : <CheckCircle className="h-4 w-4" />}
                                            Apply update
                                        </button>
                                    </div>
                                </div>
                            </div>

                            <div
                                ref={messagesContainerRef}
                                onScroll={handleMessagesScroll}
                                className="support-chat-thread flex-1 overflow-y-auto p-6 scrollbar-hide"
                            >
                                {messagesLoading ? (
                                    <div className="mt-10 text-center text-slate-400">Loading chat history...</div>
                                ) : (
                                    <div className="space-y-3">
                                        {messages.map((message, index) => {
                                            const isAdmin = Boolean(message.isAdmin);
                                            const sentAt = message?.sentAt || message?.createdAt;
                                            const previousSentAt = messages[index - 1]?.sentAt || messages[index - 1]?.createdAt;
                                            const showDayDivider = getDayKey(sentAt) !== getDayKey(previousSentAt);

                                            return (
                                                <div key={message._id || index} className="space-y-2">
                                                    {showDayDivider ? (
                                                        <div className="flex justify-center">
                                                            <div className="support-chat-date-pill text-xs font-semibold">
                                                                {formatMessageDayLabel(sentAt)}
                                                            </div>
                                                        </div>
                                                    ) : null}

                                                    {message.isSystem ? (
                                                        <div className="my-4 flex justify-center">
                                                            <div className="support-chat-system-pill text-xs">
                                                                <AlertCircle className="h-3.5 w-3.5" />
                                                                {message.text}
                                                            </div>
                                                        </div>
                                                    ) : (
                                                        <div className={cn('flex', isAdmin ? 'justify-end' : 'justify-start')}>
                                                            <div className="max-w-[min(88%,34rem)]">
                                                                <div className={cn(
                                                                    'support-chat-bubble',
                                                                    isAdmin ? 'support-chat-bubble-self' : 'support-chat-bubble-peer'
                                                                )}>
                                                                    {!isAdmin ? (
                                                                        <div className="mb-2 flex items-center gap-2 text-[11px] font-black uppercase tracking-[0.18em] text-slate-400">
                                                                            <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-white/10 text-[10px] font-black text-slate-200">
                                                                                {getInitials(message.sender?.name || message.sender?.email || 'User')}
                                                                            </span>
                                                                            {message.sender?.name || message.sender?.email || 'User'}
                                                                        </div>
                                                                    ) : (
                                                                        <div className="mb-2 flex items-center justify-end gap-2 text-[11px] font-black uppercase tracking-[0.18em] text-emerald-50/85">
                                                                            Staff reply
                                                                            <ShieldAlert className="h-3.5 w-3.5" />
                                                                        </div>
                                                                    )}
                                                                    <div className="whitespace-pre-wrap text-[15px] leading-7 text-inherit">{message.text}</div>
                                                                    <div className={cn(
                                                                        'mt-3 text-right text-[11px] font-medium',
                                                                        isAdmin ? 'text-emerald-50/75' : 'text-slate-400'
                                                                    )}>
                                                                        {formatMessageTime(sentAt)}
                                                                    </div>
                                                                </div>
                                                            </div>
                                                        </div>
                                                    )}
                                                </div>
                                            );
                                        })}
                                    </div>
                                )}
                                <div ref={messagesEndRef} />
                            </div>

                            {activeTicket.status !== 'closed' ? (
                                <form onSubmit={handleSendMessage} className="support-chat-composer p-4">
                                    <div className="relative flex gap-3">
                                        <input
                                            type="text"
                                            value={newMessage}
                                            onChange={(e) => setNewMessage(e.target.value)}
                                            placeholder="Type your official response..."
                                            className="support-chat-input flex-1 px-5 py-3.5 pr-14 font-medium"
                                        />
                                        <button
                                            type="submit"
                                            disabled={!newMessage.trim() || sending}
                                            className="support-chat-send absolute bottom-2 right-2 top-2 aspect-square disabled:opacity-50"
                                        >
                                            {sending ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Send className="ml-0.5 h-4 w-4" />}
                                        </button>
                                    </div>
                                </form>
                            ) : (
                                <div className="support-chat-composer p-4 text-center text-sm font-medium text-slate-400">
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

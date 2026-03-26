import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    AlertCircle,
    CheckCircle2,
    Clock3,
    LifeBuoy,
    MessageSquare,
    PhoneCall,
    Plus,
    RefreshCw,
    Send,
    ShieldAlert,
    ShieldCheck,
    Sparkles,
    Wifi,
    WifiOff,
    X,
} from 'lucide-react';
import { supportApi } from '@/services/api';
import { cn } from '@/lib/utils';
import { useSocket, useSocketDemand } from '@/context/SocketContext';
import { useVideoCall } from '@/context/VideoCallContext';

const TICKET_LIST_POLL_MS = 25000;
const ACTIVE_TICKET_POLL_MS = 15000;

const CATEGORY_OPTIONS = [
    {
        value: 'moderation_appeal',
        label: 'Moderation appeal',
        description: 'Warnings, suspensions, account governance, and appeal handling.',
        accent: 'text-rose-300',
    },
    {
        value: 'order_issue',
        label: 'Order issue',
        description: 'Payment, cancellation, refund, delivery, or post-order disputes.',
        accent: 'text-amber-200',
    },
    {
        value: 'general_support',
        label: 'General support',
        description: 'Profile, listing, account, or product questions that need human help.',
        accent: 'text-cyan-200',
    },
    {
        value: 'other',
        label: 'Other',
        description: 'Anything else that needs manual review and a durable response trail.',
        accent: 'text-slate-200',
    },
];

const CATEGORY_MAP = new Map(CATEGORY_OPTIONS.map((option) => [option.value, option]));

const createInitialForm = (prefill = {}) => {
    const category = CATEGORY_MAP.has(prefill?.category)
        ? prefill.category
        : (prefill?.intent === 'appeal' || prefill?.relatedActionId ? 'moderation_appeal' : 'general_support');

    return {
        category,
        subject: String(prefill?.subject || '').trim(),
        message: '',
    };
};

const sortTickets = (tickets = []) => (
    [...tickets].sort((left, right) => {
        const leftTime = new Date(left?.lastMessageAt || left?.updatedAt || left?.createdAt || 0).getTime();
        const rightTime = new Date(right?.lastMessageAt || right?.updatedAt || right?.createdAt || 0).getTime();
        return rightTime - leftTime;
    })
);

const normalizeTicket = (ticket) => {
    if (!ticket) return null;

    return {
        ...ticket,
        unreadByAdmin: Number(ticket.unreadByAdmin || 0),
        unreadByUser: Number(ticket.unreadByUser || 0),
        userActionRequired: Boolean(ticket.userActionRequired),
        subject: String(ticket.subject || ''),
        category: String(ticket.category || 'general_support'),
        status: String(ticket.status || 'open'),
        priority: String(ticket.priority || 'normal'),
        lastActorRole: String(ticket.lastActorRole || 'user'),
        resolutionSummary: String(ticket.resolutionSummary || ''),
        lastMessagePreview: String(ticket.lastMessagePreview || ''),
    };
};

const upsertTicket = (tickets, ticket) => {
    const normalized = normalizeTicket(ticket);
    if (!normalized?._id) return tickets;

    return sortTickets([
        normalized,
        ...tickets.filter((entry) => String(entry._id) !== String(normalized._id)),
    ]);
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

const getStatusBadge = (status) => {
    switch (status) {
        case 'resolved':
            return (
                <span className="inline-flex items-center gap-1 rounded-full border border-emerald-300/20 bg-emerald-500/12 px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.2em] text-emerald-100">
                    <CheckCircle2 className="h-3 w-3" /> Resolved
                </span>
            );
        case 'closed':
            return (
                <span className="inline-flex items-center gap-1 rounded-full border border-slate-400/20 bg-slate-500/10 px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.2em] text-slate-300">
                    <X className="h-3 w-3" /> Closed
                </span>
            );
        default:
            return (
                <span className="inline-flex items-center gap-1 rounded-full border border-amber-300/20 bg-amber-500/12 px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.2em] text-amber-100">
                    <Clock3 className="h-3 w-3" /> Open
                </span>
            );
    }
};

const getPriorityBadge = (priority) => {
    switch (priority) {
        case 'urgent':
            return 'border-rose-400/25 bg-rose-500/12 text-rose-100';
        case 'high':
            return 'border-amber-300/20 bg-amber-500/12 text-amber-100';
        default:
            return 'border-cyan-300/20 bg-cyan-500/12 text-cyan-100';
    }
};

const isPrefillMeaningful = (prefill = {}) => Boolean(
    prefill?.category
    || prefill?.relatedActionId
    || prefill?.subject
    || prefill?.intent
);

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
    const now = new Date();
    const sameDay = date.toDateString() === now.toDateString();
    const diffDays = Math.floor((now.setHours(0, 0, 0, 0) - new Date(date).setHours(0, 0, 0, 0)) / 86400000);

    if (sameDay) {
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

export default function SupportSection({
    profile,
    focusTicketId = '',
    startCompose = false,
    prefill = {},
}) {
    useSocketDemand('profile-support', true);
    const { socket, isConnected } = useSocket();
    const { callStatus, activeCallContext, joinSupportCall } = useVideoCall();

    const [tickets, setTickets] = useState([]);
    const [loading, setLoading] = useState(true);
    const [creating, setCreating] = useState(false);
    const [activeTicketId, setActiveTicketId] = useState(null);
    const [messages, setMessages] = useState([]);
    const [messagesLoading, setMessagesLoading] = useState(false);
    const [form, setForm] = useState(() => createInitialForm(prefill));
    const [newMessage, setNewMessage] = useState('');
    const [sending, setSending] = useState(false);
    const [creatingTicket, setCreatingTicket] = useState(false);
    const [requestingLiveCall, setRequestingLiveCall] = useState(false);
    const [error, setError] = useState('');

    const messagesEndRef = useRef(null);
    const messagesContainerRef = useRef(null);
    const shouldStickToBottomRef = useRef(true);
    const pendingScrollBehaviorRef = useRef('auto');
    const messageSignatureRef = useRef('');
    const launchRef = useRef('');

    const handleMessagesScroll = () => {
        shouldStickToBottomRef.current = isNearBottom(messagesContainerRef.current);
    };

    const supportLaunchSignature = useMemo(() => JSON.stringify({
        focusTicketId: String(focusTicketId || ''),
        startCompose: Boolean(startCompose),
        prefill: {
            category: String(prefill?.category || ''),
            relatedActionId: String(prefill?.relatedActionId || ''),
            subject: String(prefill?.subject || ''),
            intent: String(prefill?.intent || ''),
        },
    }), [focusTicketId, prefill?.category, prefill?.intent, prefill?.relatedActionId, prefill?.subject, startCompose]);

    const fetchTickets = useCallback(async ({ silent = false } = {}) => {
        try {
            if (!silent) {
                setLoading(true);
            }

            const res = await supportApi.getTickets({ limit: 50 });
            const nextTickets = sortTickets(Array.isArray(res?.data) ? res.data.map(normalizeTicket) : []);
            setTickets(nextTickets);
            setError('');

            setActiveTicketId((previous) => {
                const requested = String(focusTicketId || '');
                if (requested && nextTickets.some((ticket) => String(ticket._id) === requested)) {
                    return requested;
                }
                if (previous && nextTickets.some((ticket) => String(ticket._id) === String(previous))) {
                    return previous;
                }
                if (creating || startCompose || isPrefillMeaningful(prefill)) {
                    return null;
                }
                return previous || nextTickets[0]?._id || null;
            });
        } catch (err) {
            setError(err.message || 'Failed to load support tickets');
        } finally {
            if (!silent) {
                setLoading(false);
            }
        }
    }, [creating, focusTicketId, prefill, startCompose]);

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
            setMessages(Array.isArray(res?.data) ? res.data : []);
            setTickets((previous) => previous.map((ticket) => (
                String(ticket._id) === String(ticketId)
                    ? { ...ticket, unreadByUser: 0 }
                    : ticket
            )));
            setError('');
        } catch (err) {
            setError(err.message || 'Failed to load support conversation');
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
        if (!activeTicketId) {
            messageSignatureRef.current = '';
            pendingScrollBehaviorRef.current = '';
            setMessages([]);
            return;
        }

        shouldStickToBottomRef.current = true;
        pendingScrollBehaviorRef.current = 'auto';
        fetchMessages(activeTicketId);
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
        if (launchRef.current === supportLaunchSignature) return;
        launchRef.current = supportLaunchSignature;

        setForm(createInitialForm(prefill));

        if (focusTicketId) {
            setCreating(false);
            setActiveTicketId(focusTicketId);
            return;
        }

        if (startCompose || isPrefillMeaningful(prefill)) {
            setCreating(true);
            setActiveTicketId(null);
        }
    }, [focusTicketId, prefill, startCompose, supportLaunchSignature]);

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

        const handleTicketUpdate = (payload = {}) => {
            const nextTicket = normalizeTicket(payload.ticket);
            if (!nextTicket?._id) return;

            setTickets((previous) => upsertTicket(previous, nextTicket));
        };

        const handleMessageNew = (payload = {}) => {
            const ticketId = String(payload.ticketId || payload.ticket?._id || '');
            if (!ticketId) return;

            if (payload.ticket) {
                setTickets((previous) => upsertTicket(previous, payload.ticket));
            } else {
                setTickets((previous) => previous.map((ticket) => (
                    String(ticket._id) === ticketId
                        ? {
                            ...ticket,
                            lastMessagePreview: String(payload?.message?.text || ticket.lastMessagePreview || ''),
                            lastMessageAt: payload?.message?.sentAt || payload?.message?.createdAt || new Date().toISOString(),
                            unreadByUser: String(ticketId) === String(activeTicketId) ? 0 : (Number(ticket.unreadByUser || 0) + 1),
                        }
                        : ticket
                )));
            }

            void fetchTickets({ silent: true });

            if (String(ticketId) !== String(activeTicketId || '')) return;
            setMessages((previous) => appendUniqueMessage(previous, payload.message));
            void fetchMessages(ticketId, { silent: true });
        };

        socket.on('support:ticket:update', handleTicketUpdate);
        socket.on('support:message:new', handleMessageNew);

        return () => {
            socket.off('support:ticket:update', handleTicketUpdate);
            socket.off('support:message:new', handleMessageNew);
        };
    }, [activeTicketId, fetchMessages, fetchTickets, socket]);

    const handleCreateTicket = async (event) => {
        event.preventDefault();
        if (creatingTicket) return;

        const payload = {
            subject: String(form.subject || '').trim(),
            category: form.category,
            message: String(form.message || '').trim(),
        };

        if (prefill?.relatedActionId) {
            payload.relatedActionId = String(prefill.relatedActionId);
        }

        try {
            setCreatingTicket(true);
            const res = await supportApi.createTicket(payload);
            const createdTicket = normalizeTicket(res?.data);
            if (createdTicket) {
                setTickets((previous) => upsertTicket(previous, createdTicket));
                setActiveTicketId(createdTicket._id);
                setCreating(false);
                setForm(createInitialForm({}));
                await fetchMessages(createdTicket._id);
            }
            setError('');
        } catch (err) {
            setError(err.message || 'Failed to create support ticket');
        } finally {
            setCreatingTicket(false);
        }
    };

    const handleSendMessage = async (event) => {
        event.preventDefault();
        if (!newMessage.trim() || sending || !activeTicketId) return;

        const tempText = newMessage;
        setNewMessage('');

        try {
            setSending(true);
            const res = await supportApi.sendMessage(activeTicketId, tempText);
            const nextMessage = res?.data;
            shouldStickToBottomRef.current = true;
            pendingScrollBehaviorRef.current = 'smooth';
            setMessages((previous) => appendUniqueMessage(previous, nextMessage));
            setTickets((previous) => previous.map((ticket) => (
                String(ticket._id) === String(activeTicketId)
                    ? {
                        ...ticket,
                        lastMessagePreview: String(tempText).slice(0, 150),
                        lastMessageAt: nextMessage?.sentAt || nextMessage?.createdAt || new Date().toISOString(),
                        lastActorRole: 'user',
                        unreadByUser: 0,
                        userActionRequired: false,
                    }
                    : ticket
            )));
            setError('');
        } catch (err) {
            setError(err.message || 'Failed to send support reply');
            setNewMessage(tempText);
        } finally {
            setSending(false);
        }
    };

    const handleRequestLiveCall = async () => {
        if (!activeTicketId || requestingLiveCall) return;

        try {
            setRequestingLiveCall(true);
            const res = await supportApi.requestVideoCall(activeTicketId);
            const updatedTicket = normalizeTicket(res?.data);
            if (updatedTicket?._id) {
                setTickets((previous) => upsertTicket(previous, updatedTicket));
            }
            await fetchMessages(activeTicketId, { silent: true });
            setError('');
        } catch (err) {
            setError(err.message || 'Failed to request a live support call');
        } finally {
            setRequestingLiveCall(false);
        }
    };

    const activeTicket = tickets.find((ticket) => String(ticket._id) === String(activeTicketId));
    const activeCategory = CATEGORY_MAP.get(activeTicket?.category || form.category || 'general_support');
    const isActiveSupportCall = activeCallContext?.channelType === 'support_ticket'
        && String(activeCallContext?.contextId || '') === String(activeTicketId || '')
        && ['calling', 'incoming', 'connected'].includes(callStatus);
    const canJoinSupportCall = Boolean(
        activeTicket?._id
        && activeTicket.liveCallLastSessionKey
        && ['ringing', 'connected'].includes(String(activeTicket.liveCallLastStatus || ''))
        && !isActiveSupportCall
    );

    const handleLiveCallAction = async () => {
        if (!activeTicketId || requestingLiveCall) return;

        if (canJoinSupportCall) {
            try {
                setRequestingLiveCall(true);
                const joined = await joinSupportCall({
                    channelType: 'support_ticket',
                    contextId: activeTicketId,
                    supportTicketId: activeTicketId,
                    contextLabel: activeTicket?.liveCallLastContextLabel || `Aura Support live call for "${activeTicket?.subject || 'support ticket'}"`,
                    sessionKey: activeTicket?.liveCallLastSessionKey,
                    callerName: 'Aura Support',
                });
                if (!joined) {
                    setError('Failed to join the live support call');
                } else {
                    setError('');
                }
            } finally {
                setRequestingLiveCall(false);
            }
            return;
        }

        await handleRequestLiveCall();
    };

    const liveCallActionDisabled = Boolean(
        requestingLiveCall
        || activeTicket?.status === 'closed'
        || isActiveSupportCall
        || (!canJoinSupportCall && activeTicket?.liveCallRequested)
    );
    const liveCallActionLabel = isActiveSupportCall
        ? 'Live now'
        : canJoinSupportCall
            ? 'Join live call'
            : activeTicket?.liveCallRequested
                ? 'Requested'
                : 'Request live call';
    const liveCallComposerLabel = isActiveSupportCall
        ? 'Live call active'
        : canJoinSupportCall
            ? 'Join live call'
            : activeTicket?.liveCallRequested
                ? 'Live call queued'
                : 'Escalate to live call';
    const liveCallStatusCopy = isActiveSupportCall
        ? 'Aura Support is already ringing or connected on this ticket.'
        : activeTicket?.liveCallRequested
            ? 'Your real-time support request is queued for the support team.'
            : canJoinSupportCall
                ? 'Aura Support already opened a live session for this ticket. Join it from here.'
                : activeTicket?.liveCallLastStatus === 'ended' || activeTicket?.liveCallLastStatus === 'missed'
                    ? 'The last live call finished. Request another one if text support is still not enough.'
                    : 'Move this thread into a real-time video call when typing is too slow.';
    const liveCallStatusTime = activeTicket?.liveCallRequestedAt
        ? `Requested ${new Date(activeTicket.liveCallRequestedAt).toLocaleString()}`
        : activeTicket?.liveCallEndedAt
            ? `Last call ${new Date(activeTicket.liveCallEndedAt).toLocaleString()}`
            : '';

    return (
        <div className="grid gap-6 xl:grid-cols-[22rem_minmax(0,1fr)]">
            <div className="premium-panel flex min-h-[42rem] flex-col overflow-hidden p-0">
                <div className="border-b border-white/10 px-5 py-5">
                    <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                            <p className="text-[11px] font-black uppercase tracking-[0.28em] text-emerald-200">Support inbox</p>
                            <h3 className="mt-2 text-2xl font-black text-white">Chat with Aura Support</h3>
                            <p className="mt-1.5 text-sm text-slate-400">
                                Appeals, order issues, and live support handoffs stay in one conversation flow.
                            </p>
                        </div>
                        <div className={cn(
                            'inline-flex shrink-0 items-center gap-2 rounded-full border px-3 py-1.5 text-[11px] font-bold',
                            isConnected
                                ? 'border-emerald-300/20 bg-emerald-500/12 text-emerald-100'
                                : 'border-amber-300/20 bg-amber-500/12 text-amber-100'
                        )}>
                            {isConnected ? <Wifi className="h-3.5 w-3.5" /> : <WifiOff className="h-3.5 w-3.5" />}
                            {isConnected ? 'Live' : 'Polling'}
                        </div>
                    </div>

                    <div className="mt-4 flex flex-wrap gap-2">
                        <button
                            type="button"
                            onClick={() => {
                                setCreating(true);
                                setActiveTicketId(null);
                                setForm(createInitialForm(prefill));
                            }}
                            className="support-chat-send inline-flex items-center gap-2 px-4 py-2 text-sm font-black"
                        >
                            <Plus className="h-4 w-4" />
                            New chat
                        </button>
                        <button
                            type="button"
                            onClick={() => fetchTickets()}
                            className="support-chat-utility inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold"
                        >
                            <RefreshCw className="h-4 w-4" />
                            Refresh
                        </button>
                    </div>

                    {error ? (
                        <div className="mt-4 rounded-[1.25rem] border border-rose-400/20 bg-rose-500/12 px-4 py-3 text-sm text-rose-100">
                            {error}
                        </div>
                    ) : null}
                </div>

                <div className="flex-1 overflow-y-auto p-3 scrollbar-hide">
                    {loading ? (
                        <div className="flex h-full items-center justify-center px-6 text-center text-sm text-slate-400">
                            Loading your support threads...
                        </div>
                    ) : tickets.length === 0 ? (
                        <div className="flex h-full flex-col items-center justify-center px-6 text-center">
                            <div className="support-chat-avatar h-16 w-16 text-emerald-100">
                                <LifeBuoy className="h-8 w-8" />
                            </div>
                            <h4 className="mt-5 text-lg font-black text-white">No chats yet</h4>
                            <p className="mt-2 max-w-xs text-sm text-slate-400">
                                Start a thread when you need help with moderation, orders, or account support.
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
                                            {getInitials(CATEGORY_MAP.get(ticket.category)?.label || ticket.subject)}
                                        </div>

                                        <div className="min-w-0 flex-1">
                                            <div className="flex items-start justify-between gap-3">
                                                <div className="min-w-0">
                                                    <div className="truncate text-sm font-black text-white">{ticket.subject}</div>
                                                    <div className="mt-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">
                                                        {CATEGORY_MAP.get(ticket.category)?.label || ticket.category}
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
                                                    <span className={cn(
                                                        'rounded-full border px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.18em]',
                                                        getPriorityBadge(ticket.priority)
                                                    )}>
                                                        {ticket.priority}
                                                    </span>
                                                    {ticket.userActionRequired ? (
                                                        <span className="rounded-full border border-rose-300/20 bg-rose-500/12 px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.18em] text-rose-100">
                                                            Reply needed
                                                        </span>
                                                    ) : (
                                                        <span className="rounded-full border border-white/10 bg-white/[0.05] px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.18em] text-slate-300">
                                                            {ticket.lastActorRole === 'admin' ? 'Aura replied' : 'You replied'}
                                                        </span>
                                                    )}
                                                </div>

                                                <div className="flex shrink-0 items-center gap-2">
                                                    {ticket.unreadByUser > 0 ? (
                                                        <span className="rounded-full bg-emerald-400 px-2.5 py-1 text-[10px] font-black text-[#032114]">
                                                            {ticket.unreadByUser}
                                                        </span>
                                                    ) : null}
                                                    {getStatusBadge(ticket.status)}
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

            <div className="premium-panel min-h-[42rem] overflow-hidden p-0">
                {!creating && !activeTicket ? (
                    <div className="support-chat-thread flex h-full flex-col">
                        <div className="border-b border-white/10 px-6 py-6">
                            <p className="text-[11px] font-black uppercase tracking-[0.28em] text-emerald-200">Conversation-first support</p>
                            <h3 className="mt-2 text-3xl font-black text-white">Pick a thread or start a new one</h3>
                            <p className="mt-3 max-w-2xl text-sm text-slate-400">
                                Everything important lands here: text replies, resolution notes, and live support escalation.
                            </p>
                        </div>

                        <div className="flex flex-1 items-center justify-center px-6 py-8">
                            <div className="mx-auto w-full max-w-4xl">
                                <div className="mb-8 flex flex-col items-center text-center">
                                    <div className="support-chat-avatar h-20 w-20 text-emerald-100">
                                        <MessageSquare className="h-10 w-10" />
                                    </div>
                                    <h4 className="mt-5 text-2xl font-black text-white">Support should feel like a real conversation</h4>
                                    <p className="mt-3 max-w-2xl text-sm leading-7 text-slate-300">
                                        Open a durable thread for governance appeals, orders, or account help. Aura Support keeps the full trail visible in one place.
                                    </p>
                                </div>

                                <div className="grid gap-4 md:grid-cols-3">
                                    {CATEGORY_OPTIONS.slice(0, 3).map((option) => (
                                        <button
                                            key={option.value}
                                            type="button"
                                            onClick={() => {
                                                setCreating(true);
                                                setActiveTicketId(null);
                                                setForm((previous) => ({
                                                    ...createInitialForm(prefill),
                                                    category: option.value,
                                                    subject: previous.subject || (option.value === 'moderation_appeal' ? 'Appeal moderation action' : ''),
                                                }));
                                            }}
                                            className="support-chat-card p-5 text-left transition-all hover:-translate-y-1"
                                        >
                                            <div className={cn('text-sm font-black uppercase tracking-[0.18em]', option.accent)}>{option.label}</div>
                                            <p className="mt-3 text-sm leading-6 text-slate-300">{option.description}</p>
                                        </button>
                                    ))}
                                </div>
                            </div>
                        </div>
                    </div>
                ) : null}

                {creating ? (
                    <div className="support-chat-thread flex h-full flex-col">
                        <div className="border-b border-white/10 px-6 py-6">
                            <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0">
                                    <p className="text-[11px] font-black uppercase tracking-[0.28em] text-emerald-200">New chat</p>
                                    <h3 className="mt-2 text-3xl font-black text-white">Start a support conversation</h3>
                                    <p className="mt-3 max-w-2xl text-sm text-slate-400">
                                        This thread stays visible to you and Aura Support until the issue is actually resolved.
                                    </p>
                                </div>
                                <button
                                    type="button"
                                    onClick={() => {
                                        setCreating(false);
                                        if (!activeTicketId && tickets[0]?._id) {
                                            setActiveTicketId(tickets[0]._id);
                                        }
                                    }}
                                    className="support-chat-utility h-11 w-11 shrink-0"
                                >
                                    <X className="h-4 w-4" />
                                </button>
                            </div>
                        </div>

                        <div className="flex-1 overflow-y-auto px-4 py-5 sm:px-6">
                            <form onSubmit={handleCreateTicket} className="mx-auto flex w-full max-w-3xl flex-col gap-5">
                                {(profile?.accountState === 'warned' || profile?.accountState === 'suspended' || prefill?.relatedActionId) ? (
                                    <div className="rounded-[1.7rem] border border-amber-300/20 bg-amber-500/12 px-5 py-4 text-sm text-amber-100">
                                        <div className="flex items-start gap-3">
                                            <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0" />
                                            <div>
                                                <div className="font-black text-amber-50">Appeal-ready path</div>
                                                <p className="mt-1.5 leading-6 text-amber-100/90">
                                                    Governance-related actions route through this thread so you can contest or clarify the decision in one place.
                                                </p>
                                            </div>
                                        </div>
                                    </div>
                                ) : null}

                                <div className="rounded-[2rem] border border-white/10 bg-[#0f1720]/80 p-5 shadow-[0_24px_60px_rgba(2,8,23,0.18)]">
                                    <div className="mb-4">
                                        <div className="text-[11px] font-black uppercase tracking-[0.24em] text-slate-400">Choose a lane</div>
                                        <div className="mt-2 text-sm text-slate-300">Pick the chat type that best matches the issue.</div>
                                    </div>

                                    <div className="grid gap-3 sm:grid-cols-2">
                                        {CATEGORY_OPTIONS.map((option) => (
                                            <button
                                                key={option.value}
                                                type="button"
                                                onClick={() => setForm((previous) => ({ ...previous, category: option.value }))}
                                                className={cn(
                                                    'rounded-[1.4rem] border p-4 text-left transition-all',
                                                    form.category === option.value
                                                        ? 'border-emerald-300/25 bg-emerald-500/12 shadow-[0_18px_34px_rgba(16,185,129,0.12)]'
                                                        : 'border-white/10 bg-white/[0.04] hover:border-white/15 hover:bg-white/[0.08]'
                                                )}
                                            >
                                                <div className={cn('text-sm font-black uppercase tracking-[0.18em]', option.accent)}>{option.label}</div>
                                                <p className="mt-2 text-sm leading-6 text-slate-300">{option.description}</p>
                                            </button>
                                        ))}
                                    </div>
                                </div>

                                <div className="rounded-[2rem] border border-white/10 bg-[#0f1720]/80 p-5 shadow-[0_24px_60px_rgba(2,8,23,0.18)]">
                                    <div className="grid gap-4 md:grid-cols-2">
                                        <label className="block">
                                            <span className="mb-2 block text-[11px] font-black uppercase tracking-[0.24em] text-slate-400">Subject</span>
                                            <input
                                                type="text"
                                                required
                                                maxLength={200}
                                                value={form.subject}
                                                onChange={(event) => setForm((previous) => ({ ...previous, subject: event.target.value }))}
                                                className="support-chat-input px-4 py-3 text-sm"
                                                placeholder="Brief summary of the issue"
                                            />
                                        </label>

                                        <div className="rounded-[1.5rem] border border-white/10 bg-white/[0.04] px-4 py-4">
                                            <div className={cn('text-sm font-black uppercase tracking-[0.18em]', activeCategory?.accent || 'text-emerald-200')}>
                                                {activeCategory?.label || 'Support'}
                                            </div>
                                            <p className="mt-2 text-sm leading-6 text-slate-300">
                                                {activeCategory?.description || 'Open a thread and let Aura Support respond in the same conversation.'}
                                            </p>
                                            {prefill?.relatedActionId ? (
                                                <div className="mt-3 rounded-full border border-violet-300/20 bg-violet-500/12 px-3 py-1.5 text-[11px] font-black uppercase tracking-[0.18em] text-violet-100">
                                                    Linked action: {prefill.relatedActionId}
                                                </div>
                                            ) : null}
                                        </div>
                                    </div>

                                    <label className="mt-5 block">
                                        <span className="mb-2 block text-[11px] font-black uppercase tracking-[0.24em] text-slate-400">Tell Aura Support what happened</span>
                                        <textarea
                                            required
                                            minLength={5}
                                            maxLength={2000}
                                            value={form.message}
                                            onChange={(event) => setForm((previous) => ({ ...previous, message: event.target.value }))}
                                            className="min-h-[16rem] w-full rounded-[1.8rem] border border-white/10 bg-white/[0.05] px-4 py-4 text-sm leading-7 text-white outline-none transition-colors focus:border-emerald-300/30"
                                            placeholder="Describe the problem, what action was taken, and what kind of resolution you need."
                                        />
                                    </label>

                                    <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
                                        <div className="text-xs leading-6 text-slate-400">
                                            This thread is persistent. Replies, policy notes, and next steps stay together like a real chat history.
                                        </div>
                                        <button
                                            type="submit"
                                            disabled={creatingTicket}
                                            className="support-chat-send inline-flex items-center gap-2 px-5 py-3 text-sm font-black"
                                        >
                                            {creatingTicket ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                                            Open support chat
                                        </button>
                                    </div>
                                </div>
                            </form>
                        </div>
                    </div>
                ) : null}

                {activeTicket ? (
                    <div className="flex h-full flex-col">
                        <div className="border-b border-white/10 px-6 py-5">
                            <div className="flex items-start justify-between gap-4">
                                <div className="flex min-w-0 flex-1 items-start gap-4">
                                    <div className="support-chat-avatar h-14 w-14 shrink-0 text-base font-black">
                                        {getInitials(CATEGORY_MAP.get(activeTicket.category)?.label || activeTicket.subject)}
                                    </div>

                                    <div className="min-w-0 flex-1">
                                        <div className="flex flex-wrap items-center gap-2">
                                            <h3 className="truncate text-2xl font-black text-white">{activeTicket.subject}</h3>
                                            {getStatusBadge(activeTicket.status)}
                                            <span className={cn(
                                                'rounded-full border px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.18em]',
                                                getPriorityBadge(activeTicket.priority)
                                            )}>
                                                {activeTicket.priority}
                                            </span>
                                        </div>

                                        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-slate-400">
                                            <span className={cn('font-semibold uppercase tracking-[0.18em]', activeCategory?.accent || 'text-emerald-200')}>
                                                {CATEGORY_MAP.get(activeTicket.category)?.label || activeTicket.category}
                                            </span>
                                            <span className="text-slate-600">|</span>
                                            <span>Ticket {String(activeTicket._id).slice(-8)}</span>
                                            <span className="text-slate-600">|</span>
                                            <span>{activeTicket.lastMessageAt ? `Last activity ${new Date(activeTicket.lastMessageAt).toLocaleString()}` : 'Just opened'}</span>
                                        </div>

                                        <p className="mt-3 text-sm leading-6 text-slate-300">
                                            Text support, policy notes, and live support escalation all stay in this single thread.
                                        </p>
                                    </div>
                                </div>
                                <button
                                    type="button"
                                    onClick={() => {
                                        setActiveTicketId(null);
                                        setCreating(false);
                                    }}
                                    className="support-chat-utility h-11 w-11 shrink-0 xl:hidden"
                                >
                                    <X className="h-4 w-4" />
                                </button>
                            </div>

                            <div className="mt-4 space-y-3">
                                {activeTicket.userActionRequired ? (
                                    <div className="rounded-[1.6rem] border border-rose-300/20 bg-rose-500/12 px-4 py-4 text-sm text-rose-100">
                                        <div className="flex items-start gap-3">
                                            <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-rose-200" />
                                            <div>
                                                <div className="font-black text-white">Aura Support is waiting on your reply</div>
                                                <p className="mt-1.5 leading-6 text-rose-100/90">
                                                    Reply in this chat to keep the support or governance action moving.
                                                </p>
                                            </div>
                                        </div>
                                    </div>
                                ) : (
                                    <div className="rounded-[1.6rem] border border-white/10 bg-white/[0.04] px-4 py-4 text-sm text-slate-300">
                                        <div className="flex items-start gap-3">
                                            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-200" />
                                            <div>
                                                <div className="font-black text-white">Two-way support is active</div>
                                                <p className="mt-1.5 leading-6 text-slate-300">
                                                    This thread is the shared record for you and Aura Support. No more disconnected alerts.
                                                </p>
                                            </div>
                                        </div>
                                    </div>
                                )}

                                <div className={cn(
                                    'rounded-[1.6rem] border px-4 py-4 text-sm',
                                    activeTicket.liveCallLastStatus === 'connected' || isActiveSupportCall
                                        ? 'border-emerald-300/20 bg-emerald-500/12 text-emerald-100'
                                        : activeTicket.liveCallRequested
                                            ? 'border-cyan-300/20 bg-cyan-500/12 text-cyan-100'
                                            : 'border-white/10 bg-white/[0.04] text-slate-300'
                                )}>
                                    <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                                        <div className="min-w-0 flex-1">
                                            <div className="flex items-center gap-2 font-black text-white">
                                                <PhoneCall className="h-4 w-4 text-emerald-200" />
                                                Live support line
                                            </div>
                                            <p className="mt-2 leading-6">{liveCallStatusCopy}</p>
                                            {liveCallStatusTime ? (
                                                <p className="mt-2 text-[11px] font-black uppercase tracking-[0.2em] text-white/55">
                                                    {liveCallStatusTime}
                                                </p>
                                            ) : null}
                                        </div>
                                        <button
                                            type="button"
                                            onClick={handleLiveCallAction}
                                            disabled={liveCallActionDisabled}
                                            className="support-chat-send inline-flex items-center justify-center gap-2 px-4 py-3 text-sm font-black disabled:cursor-not-allowed"
                                        >
                                            {requestingLiveCall ? <RefreshCw className="h-4 w-4 animate-spin" /> : <PhoneCall className="h-4 w-4" />}
                                            {liveCallActionLabel}
                                        </button>
                                    </div>
                                </div>

                                {activeTicket.resolutionSummary ? (
                                    <div className="rounded-[1.6rem] border border-emerald-300/20 bg-emerald-500/12 px-4 py-4 text-sm text-emerald-100">
                                        <div className="flex items-center gap-2 font-black text-emerald-50">
                                            <CheckCircle2 className="h-4 w-4" />
                                            Resolution summary
                                        </div>
                                        <p className="mt-2 leading-6 text-emerald-100/90">{activeTicket.resolutionSummary}</p>
                                    </div>
                                ) : null}
                            </div>
                        </div>

                        <div
                            ref={messagesContainerRef}
                            onScroll={handleMessagesScroll}
                            className="support-chat-thread flex-1 overflow-y-auto px-4 py-5 scrollbar-hide sm:px-6"
                        >
                            {messagesLoading ? (
                                <div className="flex h-full items-center justify-center text-sm text-slate-400">Loading conversation...</div>
                            ) : (
                                <div className="space-y-3">
                                    {messages.map((message, index) => {
                                        const isAdmin = Boolean(message?.isAdmin);
                                        const isSystem = Boolean(message?.isSystem);
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

                                                {isSystem ? (
                                                    <div className="flex justify-center">
                                                        <div className="support-chat-system-pill text-xs">
                                                            <AlertCircle className="h-3.5 w-3.5" />
                                                            {message.text}
                                                        </div>
                                                    </div>
                                                ) : (
                                                    <div className={cn('flex', isAdmin ? 'justify-start' : 'justify-end')}>
                                                        <div className="max-w-[min(92%,34rem)]">
                                                            <div className={cn(
                                                                'support-chat-bubble',
                                                                isAdmin ? 'support-chat-bubble-peer' : 'support-chat-bubble-self'
                                                            )}>
                                                                <div className={cn(
                                                                    'mb-2 flex items-center gap-2 text-[11px] font-black uppercase tracking-[0.18em]',
                                                                    isAdmin ? 'text-rose-200' : 'text-emerald-50/85'
                                                                )}>
                                                                    {isAdmin ? (
                                                                        <>
                                                                            <ShieldAlert className="h-3.5 w-3.5" />
                                                                            Aura Support
                                                                        </>
                                                                    ) : (
                                                                        <>
                                                                            <MessageSquare className="h-3.5 w-3.5" />
                                                                            You
                                                                        </>
                                                                    )}
                                                                </div>
                                                                <div className="whitespace-pre-wrap text-sm leading-7 text-inherit">{message.text}</div>
                                                                <div className={cn(
                                                                    'mt-3 text-right text-[11px] font-medium',
                                                                    isAdmin ? 'text-slate-400' : 'text-emerald-50/75'
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
                                    <div ref={messagesEndRef} />
                                </div>
                            )}
                        </div>

                        {activeTicket.status !== 'closed' ? (
                            <form onSubmit={handleSendMessage} className="support-chat-composer px-4 py-4 sm:px-6">
                                <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
                                    <div className="relative min-w-0 flex-1">
                                        <input
                                            type="text"
                                            value={newMessage}
                                            onChange={(event) => setNewMessage(event.target.value)}
                                            placeholder={activeTicket.userActionRequired ? 'Reply to Aura Support and keep things moving...' : 'Type a message...'}
                                            className="support-chat-input px-5 py-3.5 pr-16 text-sm"
                                        />
                                        <button
                                            type="submit"
                                            disabled={!newMessage.trim() || sending}
                                            className="support-chat-send absolute right-2 top-1/2 h-11 w-11 -translate-y-1/2"
                                        >
                                            {sending ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                                        </button>
                                    </div>
                                    <button
                                        type="button"
                                        onClick={handleLiveCallAction}
                                        disabled={liveCallActionDisabled}
                                        className="support-chat-utility inline-flex h-12 justify-center gap-2 px-4 text-sm font-black disabled:cursor-not-allowed disabled:opacity-55"
                                    >
                                        {requestingLiveCall ? <RefreshCw className="h-4 w-4 animate-spin" /> : <PhoneCall className="h-4 w-4" />}
                                        {liveCallComposerLabel}
                                    </button>
                                </div>
                            </form>
                        ) : (
                            <div className="support-chat-composer px-6 py-4 text-sm text-slate-400">
                                This chat is closed. If the issue is still active, open a new thread so the next action is tracked cleanly.
                            </div>
                        )}
                    </div>
                ) : null}
            </div>
        </div>
    );
}

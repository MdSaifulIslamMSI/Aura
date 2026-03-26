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

    return (
        <div className="grid gap-6 xl:grid-cols-[22rem_minmax(0,1fr)]">
            <div className="premium-panel flex min-h-[42rem] flex-col overflow-hidden p-0">
                <div className="border-b border-white/10 bg-white/[0.02] px-5 py-4">
                    <div className="flex items-start justify-between gap-3">
                        <div>
                            <p className="text-[11px] font-black uppercase tracking-[0.22em] text-neo-cyan">Appeals & Support</p>
                            <h3 className="mt-2 text-xl font-black text-white">Persistent help desk</h3>
                            <p className="mt-1 text-sm text-slate-400">User issues, admin actions, and support replies in one durable thread.</p>
                        </div>
                        <div className={cn(
                            'inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-[11px] font-bold',
                            isConnected
                                ? 'border-emerald-300/20 bg-emerald-500/12 text-emerald-100'
                                : 'border-amber-300/20 bg-amber-500/12 text-amber-100'
                        )}>
                            {isConnected ? <Wifi className="h-3.5 w-3.5" /> : <WifiOff className="h-3.5 w-3.5" />}
                            {isConnected ? 'Live' : 'Polling'}
                        </div>
                    </div>
                    <div className="mt-4 flex gap-2">
                        <button
                            type="button"
                            onClick={() => {
                                setCreating(true);
                                setActiveTicketId(null);
                                setForm(createInitialForm(prefill));
                            }}
                            className="inline-flex items-center gap-2 rounded-xl border border-cyan-300/20 bg-cyan-400/12 px-4 py-2 text-sm font-bold text-cyan-100 transition-colors hover:bg-cyan-400/18"
                        >
                            <Plus className="h-4 w-4" />
                            New ticket
                        </button>
                        <button
                            type="button"
                            onClick={() => fetchTickets()}
                            className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-slate-300 transition-colors hover:bg-white/10 hover:text-white"
                        >
                            <RefreshCw className="h-4 w-4" />
                            Refresh
                        </button>
                    </div>
                    {error ? (
                        <div className="mt-4 rounded-2xl border border-rose-400/20 bg-rose-500/12 px-4 py-3 text-sm text-rose-100">
                            {error}
                        </div>
                    ) : null}
                </div>

                <div className="flex-1 overflow-y-auto p-3 scrollbar-hide">
                    {loading ? (
                        <div className="flex h-full items-center justify-center text-sm text-slate-400">Loading support history...</div>
                    ) : tickets.length === 0 ? (
                        <div className="flex h-full flex-col items-center justify-center px-6 text-center">
                            <div className="flex h-16 w-16 items-center justify-center rounded-3xl border border-white/10 bg-white/5 text-neo-cyan">
                                <LifeBuoy className="h-8 w-8" />
                            </div>
                            <h4 className="mt-5 text-lg font-black text-white">No tickets yet</h4>
                            <p className="mt-2 text-sm text-slate-400">When governance, order, or support issues need a real answer, the thread will stay here.</p>
                        </div>
                    ) : (
                        <div className="space-y-2">
                            {tickets.map((ticket) => (
                                <button
                                    key={ticket._id}
                                    type="button"
                                    onClick={() => {
                                        setActiveTicketId(ticket._id);
                                        setCreating(false);
                                    }}
                                    className={cn(
                                        'w-full rounded-[1.4rem] border p-4 text-left transition-all',
                                        String(activeTicketId) === String(ticket._id)
                                            ? 'border-cyan-300/25 bg-white/[0.06]'
                                            : 'border-white/5 bg-transparent hover:border-white/10 hover:bg-white/[0.03]'
                                    )}
                                >
                                    <div className="mb-2 flex items-start justify-between gap-3">
                                        <div className="min-w-0">
                                            <div className="truncate text-sm font-black text-white">{ticket.subject}</div>
                                            <div className="mt-1 flex flex-wrap items-center gap-2">
                                                <span className="rounded-full bg-white/5 px-2 py-0.5 text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">
                                                    {(CATEGORY_MAP.get(ticket.category)?.label || ticket.category).replace(/\s+/g, ' ')}
                                                </span>
                                                <span className={cn(
                                                    'rounded-full border px-2 py-0.5 text-[10px] font-black uppercase tracking-[0.18em]',
                                                    getPriorityBadge(ticket.priority)
                                                )}>
                                                    {ticket.priority}
                                                </span>
                                            </div>
                                        </div>
                                        {getStatusBadge(ticket.status)}
                                    </div>
                                    <p className="line-clamp-2 text-sm text-slate-400">{ticket.lastMessagePreview || 'No messages yet'}</p>
                                    <div className="mt-3 flex items-center justify-between text-[11px] text-slate-500">
                                        <span>{ticket.lastMessageAt ? new Date(ticket.lastMessageAt).toLocaleString() : 'Just created'}</span>
                                        <div className="flex items-center gap-2">
                                            {ticket.userActionRequired ? (
                                                <span className="rounded-full border border-rose-300/20 bg-rose-500/12 px-2 py-0.5 font-black uppercase tracking-[0.18em] text-rose-100">
                                                    Reply needed
                                                </span>
                                            ) : null}
                                            {ticket.unreadByUser > 0 ? (
                                                <span className="rounded-full bg-cyan-400 px-2 py-0.5 text-[10px] font-black text-[#02131a]">
                                                    {ticket.unreadByUser} new
                                                </span>
                                            ) : null}
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
                    <div className="flex h-full flex-col">
                        <div className="border-b border-white/10 px-6 py-6">
                            <p className="text-[11px] font-black uppercase tracking-[0.22em] text-neo-cyan">Support architecture</p>
                            <h3 className="mt-2 text-3xl font-black text-white">A real user-to-admin path</h3>
                            <p className="mt-3 max-w-2xl text-sm text-slate-400">
                                Governance actions, support replies, and user follow-ups now converge into one persistent thread instead of isolated alerts.
                            </p>
                        </div>
                        <div className="grid flex-1 gap-4 p-6 md:grid-cols-3">
                            {CATEGORY_OPTIONS.slice(0, 3).map((option) => (
                                <button
                                    key={option.value}
                                    type="button"
                                    onClick={() => {
                                        setCreating(true);
                                        setActiveTicketId(null);
                                        setForm((previous) => ({
                                            ...previous,
                                            category: option.value,
                                            subject: previous.subject || (option.value === 'moderation_appeal' ? 'Appeal moderation action' : ''),
                                        }));
                                    }}
                                    className="rounded-[1.8rem] border border-white/10 bg-white/[0.03] p-5 text-left transition-colors hover:bg-white/[0.05]"
                                >
                                    <div className={cn('text-sm font-black', option.accent)}>{option.label}</div>
                                    <p className="mt-3 text-sm text-slate-400">{option.description}</p>
                                </button>
                            ))}
                        </div>
                    </div>
                ) : null}

                {creating ? (
                    <div className="flex h-full flex-col">
                        <div className="border-b border-white/10 px-6 py-6">
                            <div className="flex items-start justify-between gap-3">
                                <div>
                                    <p className="text-[11px] font-black uppercase tracking-[0.22em] text-neo-cyan">New ticket</p>
                                    <h3 className="mt-2 text-3xl font-black text-white">Open a persistent support thread</h3>
                                    <p className="mt-3 max-w-2xl text-sm text-slate-400">
                                        This conversation stays visible to both the user and support/admin teams, including governance appeals and order disputes.
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
                                    className="rounded-xl border border-white/10 bg-white/5 p-2 text-slate-300 transition-colors hover:bg-white/10 hover:text-white"
                                >
                                    <X className="h-4 w-4" />
                                </button>
                            </div>
                            {(profile?.accountState === 'warned' || profile?.accountState === 'suspended' || prefill?.relatedActionId) ? (
                                <div className="mt-5 rounded-[1.6rem] border border-amber-300/20 bg-amber-500/12 px-4 py-4 text-sm text-amber-100">
                                    <div className="flex items-start gap-3">
                                        <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0" />
                                        <div>
                                            <div className="font-black text-amber-50">Appeal-ready support path</div>
                                            <p className="mt-1 text-amber-100/90">
                                                Governance-related actions are now routed here so users can contest or clarify a decision in one durable place.
                                            </p>
                                        </div>
                                    </div>
                                </div>
                            ) : null}
                        </div>

                        <form onSubmit={handleCreateTicket} className="flex flex-1 flex-col gap-5 p-6">
                            <div className="grid gap-4 md:grid-cols-2">
                                <label className="block">
                                    <span className="mb-2 block text-[11px] font-black uppercase tracking-[0.22em] text-slate-400">Category</span>
                                    <select
                                        value={form.category}
                                        onChange={(event) => setForm((previous) => ({ ...previous, category: event.target.value }))}
                                        className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white outline-none transition-colors focus:border-cyan-300/30"
                                    >
                                        {CATEGORY_OPTIONS.map((option) => (
                                            <option key={option.value} value={option.value} className="bg-slate-950 text-white">
                                                {option.label}
                                            </option>
                                        ))}
                                    </select>
                                </label>

                                <label className="block">
                                    <span className="mb-2 block text-[11px] font-black uppercase tracking-[0.22em] text-slate-400">Subject</span>
                                    <input
                                        type="text"
                                        required
                                        maxLength={200}
                                        value={form.subject}
                                        onChange={(event) => setForm((previous) => ({ ...previous, subject: event.target.value }))}
                                        className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white outline-none transition-colors focus:border-cyan-300/30"
                                        placeholder="Brief summary of the issue"
                                    />
                                </label>
                            </div>

                            {prefill?.relatedActionId ? (
                                <div className="rounded-2xl border border-violet-300/20 bg-violet-500/12 px-4 py-3 text-sm text-violet-100">
                                    Linked governance action: <span className="font-mono">{prefill.relatedActionId}</span>
                                </div>
                            ) : null}

                            <div className="rounded-[1.8rem] border border-white/10 bg-white/[0.03] p-4">
                                <div className={cn('text-sm font-black', activeCategory?.accent || 'text-cyan-200')}>{activeCategory?.label}</div>
                                <p className="mt-2 text-sm text-slate-400">{activeCategory?.description}</p>
                            </div>

                            <label className="flex min-h-[16rem] flex-1 flex-col">
                                <span className="mb-2 block text-[11px] font-black uppercase tracking-[0.22em] text-slate-400">Initial message</span>
                                <textarea
                                    required
                                    minLength={5}
                                    maxLength={2000}
                                    value={form.message}
                                    onChange={(event) => setForm((previous) => ({ ...previous, message: event.target.value }))}
                                    className="min-h-[16rem] flex-1 rounded-[1.8rem] border border-white/10 bg-white/5 px-4 py-4 text-sm leading-6 text-white outline-none transition-colors focus:border-cyan-300/30"
                                    placeholder="Describe what happened, what action was taken, and what resolution you need."
                                />
                            </label>

                            <div className="flex flex-wrap items-center justify-between gap-3">
                                <div className="text-xs text-slate-500">Support tickets are persistent. Admin replies, system updates, and your follow-ups stay in one thread.</div>
                                <button
                                    type="submit"
                                    disabled={creatingTicket}
                                    className="inline-flex items-center gap-2 rounded-2xl border border-cyan-300/20 bg-cyan-400/12 px-5 py-3 text-sm font-black text-cyan-100 transition-colors hover:bg-cyan-400/18 disabled:opacity-60"
                                >
                                    {creatingTicket ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                                    Open support thread
                                </button>
                            </div>
                        </form>
                    </div>
                ) : null}

                {activeTicket ? (
                    <div className="flex h-full flex-col">
                        <div className="border-b border-white/10 bg-white/[0.02] px-6 py-5">
                            <div className="flex items-start justify-between gap-4">
                                <div className="min-w-0 flex-1">
                                    <div className="flex flex-wrap items-center gap-2">
                                        <h3 className="truncate text-2xl font-black text-white">{activeTicket.subject}</h3>
                                        {getStatusBadge(activeTicket.status)}
                                        <span className={cn(
                                            'rounded-full border px-2 py-1 text-[10px] font-black uppercase tracking-[0.18em]',
                                            getPriorityBadge(activeTicket.priority)
                                        )}>
                                            {activeTicket.priority}
                                        </span>
                                    </div>
                                    <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-slate-500">
                                        <span>{CATEGORY_MAP.get(activeTicket.category)?.label || activeTicket.category}</span>
                                        <span>Ticket: {String(activeTicket._id).slice(-8)}</span>
                                        <span>Last activity: {activeTicket.lastMessageAt ? new Date(activeTicket.lastMessageAt).toLocaleString() : 'Just opened'}</span>
                                    </div>
                                </div>
                                <button
                                    type="button"
                                    onClick={() => {
                                        setActiveTicketId(null);
                                        setCreating(false);
                                    }}
                                    className="rounded-xl border border-white/10 bg-white/5 p-2 text-slate-300 transition-colors hover:bg-white/10 hover:text-white xl:hidden"
                                >
                                    <X className="h-4 w-4" />
                                </button>
                            </div>

                            <div className="mt-4 grid gap-3 md:grid-cols-2">
                                {activeTicket.userActionRequired ? (
                                    <div className="rounded-[1.5rem] border border-rose-300/20 bg-rose-500/12 px-4 py-4 text-sm text-rose-100">
                                        <div className="flex items-center gap-2 font-black text-rose-50">
                                            <ShieldAlert className="h-4 w-4" />
                                            Admin is waiting on your reply
                                        </div>
                                        <p className="mt-2 text-rose-100/90">Use this thread to answer the latest support request so governance or order handling can continue.</p>
                                    </div>
                                ) : (
                                    <div className="rounded-[1.5rem] border border-white/10 bg-white/[0.03] px-4 py-4 text-sm text-slate-300">
                                        <div className="flex items-center gap-2 font-black text-white">
                                            <ShieldCheck className="h-4 w-4 text-emerald-300" />
                                            Two-way support is active
                                        </div>
                                        <p className="mt-2 text-slate-400">Both user and admin actions now land here, not in disconnected one-off notices.</p>
                                    </div>
                                )}

                                <div className={cn(
                                    'rounded-[1.5rem] border px-4 py-4 text-sm',
                                    activeTicket.liveCallLastStatus === 'connected' || isActiveSupportCall
                                        ? 'border-emerald-300/20 bg-emerald-500/12 text-emerald-100'
                                        : activeTicket.liveCallRequested
                                            ? 'border-cyan-300/20 bg-cyan-500/12 text-cyan-100'
                                            : 'border-white/10 bg-white/[0.03] text-slate-300'
                                )}>
                                    <div className="flex items-center justify-between gap-3">
                                        <div>
                                            <div className="flex items-center gap-2 font-black text-white">
                                                <PhoneCall className="h-4 w-4 text-cyan-200" />
                                                Live support line
                                            </div>
                                            <p className="mt-2 text-sm">
                                                {isActiveSupportCall
                                                    ? 'Aura Support is actively ringing or connected on this ticket.'
                                                    : activeTicket.liveCallRequested
                                                        ? 'Your live support call request is queued for the admin team.'
                                                        : canJoinSupportCall
                                                            ? 'Aura Support already opened a live session for this ticket. Join it from here.'
                                                        : activeTicket.liveCallLastStatus === 'ended' || activeTicket.liveCallLastStatus === 'missed'
                                                            ? 'You can request another live support call if the issue still needs real-time help.'
                                                            : 'Escalate this ticket into a real-time video call when text support is too slow.'}
                                            </p>
                                            {activeTicket.liveCallRequestedAt || activeTicket.liveCallEndedAt ? (
                                                <p className="mt-2 text-xs uppercase tracking-[0.2em] text-white/50">
                                                    {activeTicket.liveCallRequestedAt
                                                        ? `Requested ${new Date(activeTicket.liveCallRequestedAt).toLocaleString()}`
                                                        : `Last call ${new Date(activeTicket.liveCallEndedAt).toLocaleString()}`}
                                                </p>
                                            ) : null}
                                        </div>
                                        <button
                                            type="button"
                                            onClick={handleLiveCallAction}
                                            disabled={requestingLiveCall || activeTicket.status === 'closed' || isActiveSupportCall || (!canJoinSupportCall && activeTicket.liveCallRequested)}
                                            className="inline-flex items-center gap-2 rounded-2xl border border-cyan-300/20 bg-cyan-400/12 px-4 py-3 text-sm font-black text-cyan-100 transition-colors hover:bg-cyan-400/18 disabled:cursor-not-allowed disabled:opacity-55"
                                        >
                                            {requestingLiveCall ? <RefreshCw className="h-4 w-4 animate-spin" /> : <PhoneCall className="h-4 w-4" />}
                                            {isActiveSupportCall ? 'Live now' : canJoinSupportCall ? 'Join live call' : activeTicket.liveCallRequested ? 'Requested' : 'Request live call'}
                                        </button>
                                    </div>
                                </div>

                                {activeTicket.resolutionSummary ? (
                                    <div className="rounded-[1.5rem] border border-emerald-300/20 bg-emerald-500/12 px-4 py-4 text-sm text-emerald-100">
                                        <div className="flex items-center gap-2 font-black text-emerald-50">
                                            <CheckCircle2 className="h-4 w-4" />
                                            Resolution summary
                                        </div>
                                        <p className="mt-2 text-emerald-100/90">{activeTicket.resolutionSummary}</p>
                                    </div>
                                ) : null}
                            </div>
                        </div>

                        <div
                            ref={messagesContainerRef}
                            onScroll={handleMessagesScroll}
                            className="flex-1 overflow-y-auto px-6 py-5 scrollbar-hide"
                        >
                            {messagesLoading ? (
                                <div className="flex h-full items-center justify-center text-sm text-slate-400">Loading conversation...</div>
                            ) : (
                                <div className="space-y-4">
                                    {messages.map((message, index) => {
                                        const isAdmin = Boolean(message?.isAdmin);
                                        const isSystem = Boolean(message?.isSystem);
                                        const sentAt = message?.sentAt || message?.createdAt;

                                        if (isSystem) {
                                            return (
                                                <div key={message._id || index} className="flex justify-center">
                                                    <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-4 py-2 text-xs text-slate-300">
                                                        <AlertCircle className="h-3.5 w-3.5" />
                                                        {message.text}
                                                    </div>
                                                </div>
                                            );
                                        }

                                        return (
                                            <div key={message._id || index} className={cn('flex', isAdmin ? 'justify-start' : 'justify-end')}>
                                                <div className={cn(
                                                    'max-w-[90%] rounded-[1.7rem] p-4',
                                                    isAdmin
                                                        ? 'rounded-tl-md border border-white/10 bg-white/[0.04] text-white'
                                                        : 'rounded-tr-md bg-cyan-400/14 text-cyan-50'
                                                )}>
                                                    <div className="mb-2 flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.22em]">
                                                        {isAdmin ? (
                                                            <>
                                                                <ShieldAlert className="h-3.5 w-3.5 text-rose-300" />
                                                                <span className="text-rose-200">Aura Support</span>
                                                            </>
                                                        ) : (
                                                            <>
                                                                <MessageSquare className="h-3.5 w-3.5 text-cyan-200" />
                                                                <span className="text-cyan-200">You</span>
                                                            </>
                                                        )}
                                                    </div>
                                                    <div className="whitespace-pre-wrap text-sm leading-6">{message.text}</div>
                                                    <div className={cn(
                                                        'mt-3 text-right text-[10px] font-medium',
                                                        isAdmin ? 'text-slate-400' : 'text-cyan-100/70'
                                                    )}>
                                                        {sentAt ? new Date(sentAt).toLocaleString() : ''}
                                                    </div>
                                                </div>
                                            </div>
                                        );
                                    })}
                                    <div ref={messagesEndRef} />
                                </div>
                            )}
                        </div>

                        {activeTicket.status !== 'closed' ? (
                            <form onSubmit={handleSendMessage} className="border-t border-white/10 bg-white/[0.02] px-6 py-4">
                                <div className="flex flex-col gap-3 sm:flex-row">
                                    <div className="relative flex-1">
                                        <input
                                            type="text"
                                            value={newMessage}
                                            onChange={(event) => setNewMessage(event.target.value)}
                                            placeholder={activeTicket.userActionRequired ? 'Reply to support and keep the action moving...' : 'Add a reply or clarification...'}
                                            className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 pr-14 text-sm text-white outline-none transition-colors focus:border-cyan-300/30"
                                        />
                                        <button
                                            type="submit"
                                            disabled={!newMessage.trim() || sending}
                                            className="absolute bottom-2 right-2 top-2 flex aspect-square items-center justify-center rounded-xl bg-cyan-400/18 text-cyan-100 transition-colors hover:bg-cyan-400/25 disabled:opacity-60"
                                        >
                                            {sending ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                                        </button>
                                    </div>
                                    <button
                                        type="button"
                                        onClick={handleLiveCallAction}
                                        disabled={requestingLiveCall || isActiveSupportCall || (!canJoinSupportCall && activeTicket.liveCallRequested)}
                                        className="inline-flex items-center justify-center gap-2 rounded-2xl border border-cyan-300/20 bg-cyan-400/12 px-4 py-3 text-sm font-black text-cyan-100 transition-colors hover:bg-cyan-400/18 disabled:opacity-55"
                                    >
                                        {requestingLiveCall ? <RefreshCw className="h-4 w-4 animate-spin" /> : <PhoneCall className="h-4 w-4" />}
                                        {isActiveSupportCall ? 'Live call active' : canJoinSupportCall ? 'Join live call' : activeTicket.liveCallRequested ? 'Live call queued' : 'Escalate to live call'}
                                    </button>
                                </div>
                            </form>
                        ) : (
                            <div className="border-t border-white/10 bg-white/[0.02] px-6 py-4 text-sm text-slate-400">
                                This ticket is closed. If the issue is still active, open a new thread so support can track the next action cleanly.
                            </div>
                        )}
                    </div>
                ) : null}
            </div>
        </div>
    );
}

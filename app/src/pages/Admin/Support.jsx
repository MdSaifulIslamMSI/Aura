import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    AlertCircle,
    CheckCircle,
    Clock,
    MessageSquare,
    PhoneCall,
    RefreshCw,
    Send,
    ShieldAlert,
    Video,
    Wifi,
    WifiOff,
    X,
} from 'lucide-react';
import { supportApi } from '@/services/api/supportApi';
import SupportArchitecturePanel from '@/components/features/support/SupportArchitecturePanel';
import SupportSpeechButton from '@/components/features/support/SupportSpeechButton';
import { cn } from '@/lib/utils';
import AdminPremiumShell from '@/components/shared/AdminPremiumShell';
import PremiumSelect from '@/components/ui/premium-select';
import { useMarket } from '@/context/MarketContext';
import { useSpeechInput } from '@/hooks/useSpeechInput';
import { useDynamicTranslations } from '@/hooks/useDynamicTranslations';
import { useSocket, useSocketDemand } from '@/context/SocketContext';
import { useVideoCall } from '@/context/VideoCallContext';
import { humanizeEnumLabel, normalizeEnumToken, translateEnumLabel } from '@/utils/enumLocalization';
import {
    buildSupportTimeline,
    createEmptySupportSummary,
    normalizeSupportSummary,
} from '@/utils/supportArchitecture';

const TICKET_LIST_POLL_MS = 20000;
const ACTIVE_TICKET_POLL_MS = 12000;
const normalizeLiveCallMode = (value) => (String(value || '').trim().toLowerCase() === 'voice' ? 'voice' : 'video');
const getLiveCallModeLabel = (value) => (normalizeLiveCallMode(value) === 'voice' ? 'voice call' : 'video call');
const getLiveCallModeTitle = (value) => (normalizeLiveCallMode(value) === 'voice' ? 'Voice Call' : 'Video Call');

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
        liveCallRequestedMode: normalizeLiveCallMode(ticket.liveCallRequestedMode),
        liveCallLastMediaMode: normalizeLiveCallMode(ticket.liveCallLastMediaMode),
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

const formatThreadPreviewTime = (value, labels = {}) => {
    if (!isValidDateValue(value)) return labels.now || 'Now';

    const date = new Date(value);
    const today = new Date();
    const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
    const startOfDate = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
    const diffDays = Math.round((startOfToday - startOfDate) / 86400000);

    if (diffDays === 0) {
        return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }

    if (diffDays === 1) {
        return labels.yesterday || 'Yesterday';
    }

    if (diffDays > 1 && diffDays < 7) {
        return date.toLocaleDateString([], { weekday: 'short' });
    }

    return date.toLocaleDateString([], { day: 'numeric', month: 'short' });
};

const formatMessageDayLabel = (value, labels = {}) => {
    if (!isValidDateValue(value)) return labels.today || 'Today';

    const date = new Date(value);
    const today = new Date();
    const yesterday = new Date();
    yesterday.setDate(today.getDate() - 1);

    if (date.toDateString() === today.toDateString()) {
        return labels.today || 'Today';
    }

    if (date.toDateString() === yesterday.toDateString()) {
        return labels.yesterday || 'Yesterday';
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

const formatSupportPriority = (t, value) => {
    const normalized = String(value || '').trim().toLowerCase();
    switch (normalized) {
        case 'urgent':
            return t('profile.support.priority.urgent', {}, 'Urgent');
        case 'high':
            return t('profile.support.priority.high', {}, 'High');
        case 'medium':
            return t('profile.support.priority.medium', {}, 'Medium');
        case 'low':
            return t('profile.support.priority.low', {}, 'Low');
        default:
            return humanizeEnumLabel(value) || t('admin.shared.unknown', {}, 'unknown');
    }
};

const formatSupportAccountState = (t, value) => {
    const normalized = String(value || '').trim().toLowerCase();
    switch (normalized) {
        case 'active':
            return t('admin.users.state.active', {}, 'Active');
        case 'warned':
            return t('admin.users.state.warned', {}, 'Warned');
        case 'suspended':
            return t('admin.users.state.suspended', {}, 'Suspended');
        case 'deleted':
            return t('admin.users.state.deleted', {}, 'Deleted');
        default:
            return value || t('admin.shared.unknown', {}, 'unknown');
    }
};

const formatSupportCategory = (t, value) => {
    const normalized = normalizeEnumToken(value);
    switch (normalized) {
        case 'moderation_appeal':
            return t('profile.support.category.moderation.label', {}, 'Moderation appeal');
        case 'order_issue':
            return t('profile.support.category.order.label', {}, 'Order issue');
        case 'general_support':
            return t('profile.support.category.general.label', {}, 'General support');
        case 'other':
            return t('profile.support.category.other.label', {}, 'Other');
        default:
            return translateEnumLabel(t, 'admin.support.category', value);
    }
};

export default function AdminSupport() {
    useSocketDemand('admin-support', true);
    const { t, formatDateTime } = useMarket();
    const { socket, isConnected, connectionState } = useSocket();
    const { startCall, joinSupportCall, callStatus, activeCallContext } = useVideoCall();
    const [tickets, setTickets] = useState([]);
    const [loading, setLoading] = useState(true);
    const [activeTicketId, setActiveTicketId] = useState(null);
    const [messages, setMessages] = useState([]);
    const [messagesLoading, setMessagesLoading] = useState(false);
    const [newMessage, setNewMessage] = useState('');
    const [sending, setSending] = useState(false);
    const [error, setError] = useState('');
    const [supportSummary, setSupportSummary] = useState(() => createEmptySupportSummary());
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
    const {
        isListening: isVoiceDrafting,
        supportsSpeechInput,
        stopListening: stopVoiceDrafting,
        toggleListening: toggleVoiceDrafting,
    } = useSpeechInput({
        value: newMessage,
        onChange: setNewMessage,
        clearOnStart: false,
        lang: 'en-IN',
    });

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
            setSupportSummary(normalizeSupportSummary(res?.meta?.summary, nextTickets));
            setActiveTicketId((prev) => {
                if (prev && nextTickets.some((ticket) => String(ticket._id) === String(prev))) {
                    return prev;
                }
                return nextTickets[0]?._id || null;
            });
            setError('');
        } catch (err) {
            setError(err.message || t('admin.support.error.loadTickets', {}, 'Failed to load tickets'));
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
            setError(err.message || t('admin.support.error.loadMessages', {}, 'Failed to load messages'));
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

        if (isVoiceDrafting) {
            stopVoiceDrafting();
        }

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
            setError(err.message || t('admin.support.error.sendMessage', {}, 'Failed to send message'));
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
            setError(err.message || t('admin.support.error.updateStatus', {}, 'Failed to update status'));
        } finally {
            setUpdatingStatus(false);
        }
    };

    const activeTicket = tickets.find((ticket) => String(ticket._id) === String(activeTicketId));
    const isSocketReconnecting = connectionState === 'connecting' || connectionState === 'reconnecting';
    const isSocketFallback = connectionState === 'disconnected';
    const socketStatusLabel = connectionState === 'connected'
        ? t('admin.support.liveSocket', {}, 'Live socket')
        : isSocketReconnecting
            ? t('admin.support.reconnecting', {}, 'Reconnecting...')
            : t('admin.support.pollingFallback', {}, 'Polling fallback');
    const supportRelativeLabels = {
        now: t('admin.support.now', {}, 'Now'),
        today: t('admin.support.today', {}, 'Today'),
        yesterday: t('admin.support.yesterday', {}, 'Yesterday'),
    };
    const isActiveSupportCall = activeCallContext?.channelType === 'support_ticket'
        && String(activeCallContext?.contextId || '') === String(activeTicketId || '')
        && ['calling', 'incoming', 'connected'].includes(callStatus);
    const supportLiveCallMode = normalizeLiveCallMode(
        activeCallContext?.mediaMode
        || activeTicket?.liveCallLastMediaMode
        || activeTicket?.liveCallRequestedMode
    );
    const supportLiveCallLabel = supportLiveCallMode === 'voice'
        ? t('admin.support.voiceCall', {}, 'voice call')
        : t('admin.support.videoCall', {}, 'video call');
    const supportLiveCallTitle = supportLiveCallMode === 'voice'
        ? t('admin.support.voiceCallTitle', {}, 'Voice Call')
        : t('admin.support.videoCallTitle', {}, 'Video Call');
    const canJoinSupportCall = Boolean(
        activeTicket?._id
        && activeTicket.liveCallLastSessionKey
        && ['ringing', 'connected'].includes(String(activeTicket.liveCallLastStatus || ''))
        && !isActiveSupportCall
    );
    const supportDynamicTexts = useMemo(() => ([
        ...(tickets || []).flatMap((ticket) => [
            ticket?.subject,
            ticket?.lastMessagePreview,
            ticket?.resolutionSummary,
            ticket?.liveCallLastContextLabel,
        ]),
        ...(messages || []).map((message) => message?.text),
        error,
    ]), [error, messages, tickets]);
    const { translateText: translateSupportText } = useDynamicTranslations(supportDynamicTexts);
    const queueSummary = useMemo(
        () => normalizeSupportSummary(supportSummary, tickets),
        [supportSummary, tickets]
    );
    const liveQueueCount = queueSummary.queuedLiveCalls + queueSummary.ringingLiveCalls + queueSummary.connectedLiveCalls;
    const adminArchitectureMetrics = useMemo(() => ([
        {
            label: t('admin.support.arch.openQueue', {}, 'Open queue'),
            value: queueSummary.openTickets,
            detail: t(
                'admin.support.arch.openQueueBody',
                { total: queueSummary.totalTickets },
                `${queueSummary.totalTickets} total threads are in the current queue view.`
            ),
            tone: queueSummary.openTickets > 0 ? 'cyan' : 'slate',
            icon: 'queue',
        },
        {
            label: t('admin.support.arch.needsReply', {}, 'Needs reply'),
            value: queueSummary.waitingOnAdmin,
            detail: t(
                'admin.support.arch.needsReplyBody',
                { count: queueSummary.unreadBacklog },
                `${queueSummary.unreadBacklog} unread customer messages are waiting for staff review.`
            ),
            tone: queueSummary.waitingOnAdmin > 0 ? 'amber' : 'emerald',
            icon: 'chat',
        },
        {
            label: t('admin.support.arch.liveLanes', {}, 'Live lanes'),
            value: liveQueueCount,
            detail: t(
                'admin.support.arch.liveLanesBody',
                { connected: queueSummary.connectedLiveCalls, queued: queueSummary.queuedLiveCalls + queueSummary.ringingLiveCalls },
                `${queueSummary.connectedLiveCalls} connected and ${queueSummary.queuedLiveCalls + queueSummary.ringingLiveCalls} preparing or queued.`
            ),
            tone: liveQueueCount > 0 ? 'emerald' : 'slate',
            icon: 'video',
        },
        {
            label: t('admin.support.arch.voiceLanes', {}, 'Voice lanes'),
            value: queueSummary.voiceLiveCalls,
            detail: t(
                'admin.support.arch.voiceLanesBody',
                { video: queueSummary.videoLiveCalls },
                `${queueSummary.videoLiveCalls} video lanes are active or queued beside voice.`
            ),
            tone: queueSummary.voiceLiveCalls > 0 ? 'cyan' : 'slate',
            icon: 'voice',
        },
        {
            label: t('admin.support.arch.urgent', {}, 'Urgent'),
            value: queueSummary.urgentTickets,
            detail: t(
                'admin.support.arch.urgentBody',
                { stale: queueSummary.staleOpenTickets },
                `${queueSummary.staleOpenTickets} open threads are aging past the fast-response window.`
            ),
            tone: queueSummary.urgentTickets > 0 || queueSummary.staleOpenTickets > 0 ? 'rose' : 'slate',
            icon: 'resolution',
        },
    ]), [liveQueueCount, queueSummary, t]);
    const adminArchitectureInsight = useMemo(() => {
        if (queueSummary.waitingOnAdmin > 0) {
            return {
                label: t('admin.support.arch.action', {}, 'Action focus'),
                title: t(
                    'admin.support.arch.actionReplyTitle',
                    { count: queueSummary.waitingOnAdmin },
                    `${queueSummary.waitingOnAdmin} threads are waiting on a staff reply`
                ),
                body: t(
                    'admin.support.arch.actionReplyBody',
                    { urgent: queueSummary.urgentTickets },
                    queueSummary.urgentTickets > 0
                        ? `${queueSummary.urgentTickets} of those threads are urgent, so the fastest acceleration is reply-first triage before opening more live lanes.`
                        : 'Fastest acceleration right now is clearing text backlog so live calls stay reserved for the issues that truly need real-time handling.'
                ),
                tone: queueSummary.urgentTickets > 0 ? 'rose' : 'amber',
                icon: 'insight',
            };
        }

        if (queueSummary.connectedLiveCalls > 0) {
            return {
                label: t('admin.support.arch.action', {}, 'Action focus'),
                title: t(
                    'admin.support.arch.actionLiveTitle',
                    { count: queueSummary.connectedLiveCalls },
                    `${queueSummary.connectedLiveCalls} live support lanes are active`
                ),
                body: t(
                    'admin.support.arch.actionLiveBody',
                    {},
                    'Keep the queue moving by using chat for lightweight follow-up while voice and video handle the trust-critical moments.'
                ),
                tone: 'emerald',
                icon: 'insight',
            };
        }

        if (queueSummary.urgentTickets > 0) {
            return {
                label: t('admin.support.arch.action', {}, 'Action focus'),
                title: t(
                    'admin.support.arch.actionUrgentTitle',
                    { count: queueSummary.urgentTickets },
                    `${queueSummary.urgentTickets} urgent cases are in scope`
                ),
                body: t(
                    'admin.support.arch.actionUrgentBody',
                    {},
                    'Moderation and high-trust issues should move through a tight chat-to-call path so the resolution notes stay durable after the live interaction ends.'
                ),
                tone: 'rose',
                icon: 'insight',
            };
        }

        return {
            label: t('admin.support.arch.action', {}, 'Action focus'),
            title: t('admin.support.arch.actionStableTitle', {}, 'Queue is stable and ready to accelerate'),
            body: t(
                'admin.support.arch.actionStableBody',
                {},
                'Use voice and video selectively while the durable chat trail continues to carry the official resolution record.'
            ),
            tone: 'cyan',
            icon: 'insight',
        };
    }, [queueSummary, t]);
    const adminArchitectureStages = useMemo(() => {
        if (activeTicket?._id) {
            return buildSupportTimeline({
                ticket: activeTicket,
                activeCallContext,
                callStatus,
            });
        }

        return [
            {
                key: 'chat',
                icon: 'chat',
                label: 'Chat intake',
                state: queueSummary.openTickets > 0 ? 'active' : 'complete',
                detail: `${queueSummary.openTickets} open tickets are flowing through the durable support thread.`,
            },
            {
                key: 'voice',
                icon: 'voice',
                label: 'Voice escalation',
                state: queueSummary.voiceLiveCalls > 0 ? 'active' : 'pending',
                detail: queueSummary.voiceLiveCalls > 0
                    ? `${queueSummary.voiceLiveCalls} voice lanes are active or queued.`
                    : 'Voice is ready for faster trust repair when text slows down.',
            },
            {
                key: 'video',
                icon: 'video',
                label: 'Video escalation',
                state: queueSummary.videoLiveCalls > 0 ? 'active' : 'pending',
                detail: queueSummary.videoLiveCalls > 0
                    ? `${queueSummary.videoLiveCalls} video lanes are active or queued.`
                    : 'Video stays available for visual proof, walkthroughs, and high-touch support.',
            },
            {
                key: 'resolution',
                icon: 'resolution',
                label: 'Resolution record',
                state: (queueSummary.resolvedTickets + queueSummary.closedTickets) > 0 ? 'complete' : 'active',
                detail: `${queueSummary.resolvedTickets + queueSummary.closedTickets} tickets already have durable outcomes captured in-thread.`,
            },
        ];
    }, [activeCallContext, activeTicket, callStatus, queueSummary]);
    const adminArchitectureBadges = useMemo(() => ([
        {
            label: socketStatusLabel,
            tone: connectionState === 'connected' ? 'emerald' : isSocketReconnecting ? 'amber' : 'rose',
            icon: 'queue',
        },
        {
            label: activeTicket?._id
                ? t('admin.support.arch.focusBadge', { subject: activeTicket.subject }, `Focused on ${activeTicket.subject}`)
                : t('admin.support.arch.focusNone', {}, 'Queue-wide view'),
            tone: activeTicket?._id ? 'cyan' : 'slate',
            icon: activeTicket?._id && supportLiveCallMode === 'voice' ? 'voice' : 'video',
        },
    ]), [activeTicket, connectionState, isSocketReconnecting, socketStatusLabel, supportLiveCallMode, t]);

    const handleStartLiveCall = async (mediaMode = 'video') => {
        if (!activeTicket?._id || !activeTicket?.user?._id || startingLiveCall) return;

        try {
            setStartingLiveCall(true);
            const liveCallAction = canJoinSupportCall
                ? await joinSupportCall({
                    channelType: 'support_ticket',
                    contextId: activeTicket._id,
                    supportTicketId: activeTicket._id,
                    contextLabel: activeTicket.liveCallLastContextLabel || t('admin.support.liveCallContext', { subject: activeTicket.subject }, `Aura Support live call for "${activeTicket.subject}"`),
                    sessionKey: activeTicket.liveCallLastSessionKey,
                    callerName: t('admin.support.callerName', {}, 'Aura Support'),
                    mediaMode: supportLiveCallMode,
                })
                : await startCall({
                    targetUserId: activeTicket.user._id,
                    channelType: 'support_ticket',
                    contextId: activeTicket._id,
                    supportTicketId: activeTicket._id,
                    contextLabel: normalizeLiveCallMode(mediaMode) === 'voice'
                        ? t('admin.support.voiceCallContext', { subject: activeTicket.subject }, `Aura Support voice call for "${activeTicket.subject}"`)
                        : t('admin.support.liveCallContext', { subject: activeTicket.subject }, `Aura Support live call for "${activeTicket.subject}"`),
                    mediaMode,
                });
            if (!liveCallAction) {
                setError(canJoinSupportCall
                    ? t('admin.support.error.joinCall', { label: supportLiveCallLabel }, `Failed to join the ${supportLiveCallLabel}`)
                    : t('admin.support.error.startCall', { label: normalizeLiveCallMode(mediaMode) === 'voice' ? t('admin.support.voiceCall', {}, 'voice call') : t('admin.support.videoCall', {}, 'video call') }, `Failed to start the ${normalizeLiveCallMode(mediaMode) === 'voice' ? 'voice call' : 'video call'}`));
            }
        } finally {
            setStartingLiveCall(false);
        }
    };

    const liveCallActionLabel = isActiveSupportCall
        ? t('admin.support.liveNow', {}, 'Live now')
        : canJoinSupportCall
            ? t('admin.support.joinCall', { label: supportLiveCallLabel }, `Join ${supportLiveCallLabel}`)
            : t('admin.support.startCall', { label: supportLiveCallLabel }, `Start ${supportLiveCallLabel}`);
    const liveCallStatusCopy = isActiveSupportCall
        ? t('admin.support.status.activeCall', { label: supportLiveCallLabel }, `A ${supportLiveCallLabel} is already ringing or connected on this ticket.`)
        : isSocketFallback
            ? t('admin.support.status.pollingFallback', {}, 'Ticket updates are on polling fallback, but the live call itself can still run over LiveKit.')
            : isSocketReconnecting
                ? t('admin.support.status.reconnecting', {}, 'Ticket updates are reconnecting now. LiveKit calls can stay active while the socket recovers.')
            : activeTicket?.liveCallRequested
                ? t('admin.support.status.requested', { label: normalizeLiveCallMode(activeTicket?.liveCallRequestedMode) === 'voice' ? t('admin.support.voiceCall', {}, 'voice call') : t('admin.support.videoCall', {}, 'video call') }, `The customer requested a ${normalizeLiveCallMode(activeTicket?.liveCallRequestedMode) === 'voice' ? 'voice call' : 'video call'}. Start the call when you are ready.`)
                : canJoinSupportCall
                    ? t('admin.support.status.rejoin', { label: supportLiveCallLabel }, `A ${supportLiveCallLabel} is already open for this ticket. Rejoin it from here.`)
                    : activeTicket?.liveCallLastStatus === 'ended' || activeTicket?.liveCallLastStatus === 'missed'
                        ? t('admin.support.status.lastFinished', { label: supportLiveCallLabel }, `The last ${supportLiveCallLabel} finished. Start another one if real-time handling is still needed.`)
                        : t('admin.support.status.default', {}, 'Escalate this ticket into a real-time voice or video call when text support is too slow.');
    const liveCallStatusTime = activeTicket?.liveCallRequestedAt
        ? t('admin.support.requestedAt', { time: formatDateTime(activeTicket.liveCallRequestedAt) }, `Requested ${formatDateTime(activeTicket.liveCallRequestedAt)}`)
        : activeTicket?.liveCallEndedAt
            ? t('admin.support.lastEndedAt', { time: formatDateTime(activeTicket.liveCallEndedAt) }, `Last ended ${formatDateTime(activeTicket.liveCallEndedAt)}`)
            : t('admin.support.noLiveCallYet', {}, 'No live call yet');

    const getStatusBadge = (status) => {
        switch (status) {
            case 'open':
                return <span className="inline-flex items-center gap-1 rounded-full border border-amber-300/20 bg-amber-500/12 px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.18em] text-amber-100"><Clock className="h-3 w-3" /> {t('admin.support.open', {}, 'Open')}</span>;
            case 'resolved':
                return <span className="inline-flex items-center gap-1 rounded-full border border-emerald-300/20 bg-emerald-500/12 px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.18em] text-emerald-100"><CheckCircle className="h-3 w-3" /> {t('admin.support.resolved', {}, 'Resolved')}</span>;
            case 'closed':
                return <span className="inline-flex items-center gap-1 rounded-full border border-slate-400/20 bg-slate-500/10 px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.18em] text-slate-300"><X className="h-3 w-3" /> {t('admin.support.closed', {}, 'Closed')}</span>;
            default:
                return null;
        }
    };

    return (
        <AdminPremiumShell
            eyebrow={t('admin.support.eyebrow', {}, 'Customer Service')}
            title={t('admin.support.title', {}, 'Support & Appeals')}
            description={t('admin.support.description', {}, 'Manage moderation appeals and support tickets with live admin updates, resilient polling fallback, and direct conversation control.')}
            actions={(
                <div className="flex flex-wrap gap-3">
                    <div className={cn(
                        'inline-flex items-center gap-2 rounded-full border px-3 py-2 text-xs font-semibold',
                        connectionState === 'connected'
                            ? 'border-emerald-300/20 bg-emerald-500/12 text-emerald-100'
                            : isSocketReconnecting
                                ? 'border-amber-300/20 bg-amber-500/12 text-amber-100'
                                : 'border-rose-300/20 bg-rose-500/12 text-rose-100'
                    )}>
                        {connectionState === 'connected' ? <Wifi className="h-3.5 w-3.5" /> : <WifiOff className="h-3.5 w-3.5" />}
                        {socketStatusLabel}
                    </div>
                    <PremiumSelect value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="w-[150px]">
                        <option value="">{t('admin.support.allTickets', {}, 'All Tickets')}</option>
                        <option value="open">{t('admin.support.open', {}, 'Open')}</option>
                        <option value="resolved">{t('admin.support.resolved', {}, 'Resolved')}</option>
                        <option value="closed">{t('admin.support.closed', {}, 'Closed')}</option>
                    </PremiumSelect>
                    <button type="button" onClick={() => fetchTickets()} className="admin-premium-button">
                        <RefreshCw className="h-4 w-4" />
                        {t('admin.shared.refresh', {}, 'Refresh')}
                    </button>
                </div>
            )}
        >
            <div className="space-y-6">
                <SupportArchitecturePanel
                    eyebrow={t('admin.support.arch.eyebrow', {}, 'Omnichannel architecture')}
                    title={t('admin.support.arch.title', {}, 'Chat, voice, and video now move as one support system')}
                    description={t(
                        'admin.support.arch.description',
                        {},
                        'Keep durable chat history, accelerate into voice or video when necessary, and manage the whole queue with live operational context.'
                    )}
                    metrics={adminArchitectureMetrics}
                    insight={adminArchitectureInsight}
                    stages={adminArchitectureStages}
                    badges={adminArchitectureBadges}
                />

                <div className="grid min-h-[700px] gap-6 xl:grid-cols-[24rem_minmax(0,1fr)]">
                    <div className="flex w-full flex-col overflow-hidden admin-premium-panel p-0">
                    <div className="border-b border-white/10 px-5 py-5">
                        <p className="text-[11px] font-black uppercase tracking-[0.28em] text-emerald-200">{t('admin.support.supportDesk', {}, 'Support desk')}</p>
                        <h3 className="mt-2 text-2xl font-black text-white">{t('admin.support.customerChatQueue', {}, 'Customer chat queue')}</h3>
                        <p className="mt-1.5 text-sm text-slate-400">
                            {t('admin.support.queueBody', {}, 'Ticket handling, resolution notes, and live support now move like a shared messaging tool.')}
                        </p>

                        {error ? (
                            <div className="mt-4 rounded-[1.25rem] border border-rose-400/20 bg-rose-500/12 p-3 text-sm font-medium text-rose-100">
                                {translateSupportText(error)}
                            </div>
                        ) : null}
                    </div>

                    <div className="relative flex-1 space-y-3 overflow-y-auto p-3 scrollbar-hide">
                        {loading ? (
                            <div className="p-6 text-center text-sm text-slate-400">{t('admin.support.loadingTickets', {}, 'Loading tickets...')}</div>
                        ) : tickets.length === 0 ? (
                            <div className="flex h-full flex-col items-center justify-center p-6 text-center">
                                <div className="support-chat-avatar h-16 w-16 text-emerald-100">
                                    <MessageSquare className="h-8 w-8" />
                                </div>
                                <div className="mt-5 text-lg font-black text-white">{t('admin.support.noTicketsFound', {}, 'No tickets found')}</div>
                                <p className="mt-2 max-w-xs text-sm text-slate-400">
                                    {t('admin.support.noTicketsBody', {}, 'When customers need help, their threads will appear here in queue order.')}
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
                                            {getInitials(ticket.user?.name || ticket.user?.email || translateSupportText(ticket.subject))}
                                        </div>

                                        <div className="min-w-0 flex-1">
                                            <div className="flex items-start justify-between gap-3">
                                                    <div className="min-w-0">
                                                    <div className="truncate text-sm font-black text-white" title={translateSupportText(ticket.subject)}>{translateSupportText(ticket.subject)}</div>
                                                    <div className="mt-1 truncate text-[11px] font-medium text-slate-400">
                                                        {ticket.user?.email || ticket.user?.name || t('admin.support.unknownUser', {}, 'Unknown user')}
                                                    </div>
                                                </div>
                                                <span className="shrink-0 text-[11px] font-medium text-slate-400">
                                                    {formatThreadPreviewTime(ticket.lastMessageAt || ticket.updatedAt || ticket.createdAt, supportRelativeLabels)}
                                                </span>
                                            </div>

                                            <div className="mt-3 line-clamp-2 text-sm leading-6 text-slate-300">
                                                {translateSupportText(ticket.lastMessagePreview) || t('admin.support.noMessagesYet', {}, 'No messages yet.')}
                                            </div>

                                            <div className="mt-3 flex items-center justify-between gap-3">
                                                <div className="flex flex-wrap items-center gap-2">
                                                    <span className="rounded-full border border-white/10 bg-white/[0.05] px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.18em] text-slate-200">
                                                        {formatSupportCategory(t, ticket.category)}
                                                    </span>
                                                    <span className={cn(
                                                        'rounded-full border px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.18em]',
                                                        ticket.priority === 'urgent'
                                                            ? 'border-rose-300/20 bg-rose-500/12 text-rose-100'
                                                            : ticket.priority === 'high'
                                                                ? 'border-amber-300/20 bg-amber-500/12 text-amber-100'
                                                                : 'border-cyan-300/20 bg-cyan-500/12 text-cyan-100'
                                                    )}>
                                                        {formatSupportPriority(t, ticket.priority)}
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
                            <h4 className="mt-5 text-2xl font-black text-white">{t('admin.support.selectThread', {}, 'Select a customer thread')}</h4>
                            <p className="mt-3 max-w-xl text-sm leading-7 text-slate-300">
                                {t('admin.support.selectThreadBody', {}, 'Open any ticket on the left to jump into the conversation, update the resolution state, or escalate to live support.')}
                            </p>
                        </div>
                    ) : activeTicket ? (
                        <>
                            <div className="border-b border-white/10 px-5 py-5">
                                <div className="flex items-start justify-between gap-4">
                                    <div className="flex min-w-0 flex-1 items-start gap-4 pr-4">
                                        <div className="support-chat-avatar h-14 w-14 shrink-0 text-base font-black">
                                            {getInitials(activeTicket.user?.name || activeTicket.user?.email || translateSupportText(activeTicket.subject))}
                                        </div>
                                        <div className="min-w-0 flex-1">
                                    <h3 className="truncate text-2xl font-black text-white">{translateSupportText(activeTicket.subject)}</h3>
                                    <div className="mt-1 flex flex-wrap items-center gap-2 font-mono text-xs text-slate-400">
                                        <span>{activeTicket.user?.email || activeTicket.user?.name || t('admin.support.unknownUser', {}, 'Unknown user')}</span>
                                        <span>|</span>
                                        <span className={cn(
                                            activeTicket.user?.accountState === 'suspended'
                                                ? 'font-bold text-rose-300'
                                                : 'font-bold text-emerald-300'
                                        )}>
                                            {formatSupportAccountState(t, activeTicket.user?.accountState)}
                                        </span>
                                    </div>
                                    <div className="mt-3 flex flex-wrap items-center gap-2 text-[10px] font-black uppercase tracking-[0.18em]">
                                        <span className="rounded-full border border-white/10 bg-white/[0.06] px-2 py-0.5 text-slate-200">
                                            {formatSupportCategory(t, activeTicket.category)}
                                        </span>
                                        <span className={cn(
                                            'rounded-full border px-2 py-0.5',
                                            activeTicket.priority === 'urgent'
                                                ? 'border-rose-300/20 bg-rose-500/12 text-rose-100'
                                                : activeTicket.priority === 'high'
                                                    ? 'border-amber-300/20 bg-amber-500/12 text-amber-100'
                                                    : 'border-cyan-300/20 bg-cyan-500/12 text-cyan-100'
                                        )}>
                                            {formatSupportPriority(t, activeTicket.priority)}
                                        </span>
                                        {activeTicket.userActionRequired ? (
                                            <span className="rounded-full border border-rose-300/20 bg-rose-500/12 px-2 py-0.5 text-rose-100">
                                                {t('admin.support.userActionRequired', {}, 'user action required')}
                                            </span>
                                        ) : null}
                                        {activeTicket.liveCallRequested ? (
                                            <span className="rounded-full border border-cyan-300/20 bg-cyan-500/12 px-2 py-0.5 text-cyan-100">
                                                {t('admin.support.requestedBadge', { label: normalizeLiveCallMode(activeTicket.liveCallRequestedMode) === 'voice' ? t('admin.support.voiceCallTitle', {}, 'Voice Call') : t('admin.support.videoCallTitle', {}, 'Video Call') }, `${normalizeLiveCallMode(activeTicket.liveCallRequestedMode) === 'voice' ? 'Voice Call' : 'Video Call'} requested`)}
                                            </span>
                                        ) : null}
                                        {activeTicket.liveCallLastStatus === 'connected' || isActiveSupportCall ? (
                                            <span className="rounded-full border border-emerald-300/20 bg-emerald-500/12 px-2 py-0.5 text-emerald-100">
                                                {t('admin.support.activeBadge', { label: supportLiveCallTitle }, `${supportLiveCallTitle} active`)}
                                            </span>
                                        ) : null}
                                    </div>
                                        </div>
                                    </div>
                                    <div className="flex shrink-0 items-center gap-2">
                                        {getStatusBadge(activeTicket.status)}
                                        {canJoinSupportCall || isActiveSupportCall ? (
                                            <button
                                                type="button"
                                                onClick={() => handleStartLiveCall(supportLiveCallMode)}
                                                disabled={startingLiveCall || activeTicket.status === 'closed' || !activeTicket.user?._id || isActiveSupportCall}
                                                className="support-chat-send inline-flex items-center gap-2 px-4 py-2.5 text-sm font-black disabled:cursor-not-allowed"
                                            >
                                                {startingLiveCall ? (
                                                    <RefreshCw className="h-4 w-4 animate-spin" />
                                                ) : supportLiveCallMode === 'voice' ? (
                                                    <PhoneCall className="h-4 w-4" />
                                                ) : (
                                                    <Video className="h-4 w-4" />
                                                )}
                                                {liveCallActionLabel}
                                            </button>
                                        ) : (
                                            <div className="flex flex-wrap items-center gap-2">
                                                <button
                                                    type="button"
                                                    onClick={() => handleStartLiveCall('voice')}
                                                    disabled={startingLiveCall || activeTicket.status === 'closed' || !activeTicket.user?._id}
                                                    className="support-chat-utility inline-flex items-center gap-2 px-4 py-2.5 text-sm font-black disabled:cursor-not-allowed disabled:opacity-55"
                                                >
                                                    {startingLiveCall ? <RefreshCw className="h-4 w-4 animate-spin" /> : <PhoneCall className="h-4 w-4" />}
                                                    {t('admin.support.voiceCallTitle', {}, 'Voice call')}
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={() => handleStartLiveCall('video')}
                                                    disabled={startingLiveCall || activeTicket.status === 'closed' || !activeTicket.user?._id}
                                                    className="support-chat-send inline-flex items-center gap-2 px-4 py-2.5 text-sm font-black disabled:cursor-not-allowed"
                                                >
                                                    {startingLiveCall ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Video className="h-4 w-4" />}
                                                    {t('admin.support.videoCallTitle', {}, 'Video call')}
                                                </button>
                                            </div>
                                        )}
                                    </div>
                                </div>
                                {activeTicket.resolutionSummary ? (
                                    <div className="mt-4 rounded-[1.5rem] border border-emerald-300/20 bg-emerald-500/12 p-4 text-sm text-emerald-100">
                                        <div className="mb-1 text-xs font-black uppercase tracking-[0.18em] text-emerald-200">{t('admin.support.currentResolutionSummary', {}, 'Current resolution summary')}</div>
                                        <div className="leading-6">{translateSupportText(activeTicket.resolutionSummary)}</div>
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
                                            <div className="text-xs font-black uppercase tracking-[0.18em] text-slate-400">{t('admin.support.liveSupportLane', {}, 'Live support lane')}</div>
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
                                        <option value="open">{t('admin.support.open', {}, 'Open')}</option>
                                        <option value="resolved">{t('admin.support.resolved', {}, 'Resolved')}</option>
                                        <option value="closed">{t('admin.support.closed', {}, 'Closed')}</option>
                                    </PremiumSelect>
                                    <textarea
                                        value={resolutionDraft}
                                        onChange={(e) => setResolutionDraft(e.target.value)}
                                        rows={2}
                                        maxLength={800}
                                        placeholder={t('admin.support.resolutionPlaceholder', {}, 'Add the resolution, policy note, or next step the user should actually see.')}
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
                                            <span>{t('admin.support.userActionRequired', {}, 'User action required')}</span>
                                        </label>
                                        <button
                                            type="button"
                                            onClick={handleUpdateStatus}
                                            disabled={updatingStatus}
                                            className="support-chat-utility justify-center px-4 py-3 text-sm font-black"
                                        >
                                            {updatingStatus ? <RefreshCw className="h-4 w-4 animate-spin" /> : <CheckCircle className="h-4 w-4" />}
                                            {t('admin.support.applyUpdate', {}, 'Apply update')}
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
                                    <div className="mt-10 text-center text-slate-400">{t('admin.support.loadingChatHistory', {}, 'Loading chat history...')}</div>
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
                                                                {formatMessageDayLabel(sentAt, supportRelativeLabels)}
                                                            </div>
                                                        </div>
                                                    ) : null}

                                                    {message.isSystem ? (
                                                        <div className="my-4 flex justify-center">
                                                            <div className="support-chat-system-pill text-xs">
                                                                <AlertCircle className="h-3.5 w-3.5" />
                                                                {translateSupportText(message.text)}
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
                                                                                {getInitials(message.sender?.name || message.sender?.email || t('admin.support.user', {}, 'User'))}
                                                                            </span>
                                                                            {message.sender?.name || message.sender?.email || t('admin.support.user', {}, 'User')}
                                                                        </div>
                                                                    ) : (
                                                                        <div className="mb-2 flex items-center justify-end gap-2 text-[11px] font-black uppercase tracking-[0.18em] text-emerald-50/85">
                                                                            {t('admin.support.staffReply', {}, 'Staff reply')}
                                                                            <ShieldAlert className="h-3.5 w-3.5" />
                                                                        </div>
                                                                    )}
                                                                    <div className="whitespace-pre-wrap text-[15px] leading-7 text-inherit">{translateSupportText(message.text)}</div>
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
                                    <div className="flex flex-col gap-3">
                                        <div className="relative flex gap-3">
                                            <input
                                                type="text"
                                                value={newMessage}
                                                onChange={(e) => setNewMessage(e.target.value)}
                                                placeholder={t('admin.support.composerPlaceholder', {}, 'Type your official response...')}
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

                                        <div className="flex flex-wrap items-center justify-between gap-3 text-[11px] font-semibold text-slate-400">
                                            <div>
                                                {t(
                                                    'admin.support.voiceDraftHint',
                                                    {},
                                                    'Voice drafting keeps the response in this same support thread before you send it.'
                                                )}
                                            </div>
                                            <SupportSpeechButton
                                                supportsSpeechInput={supportsSpeechInput}
                                                isListening={isVoiceDrafting}
                                                onToggle={toggleVoiceDrafting}
                                                disabled={sending}
                                                idleLabel={t('admin.support.voiceDraft', {}, 'Voice draft')}
                                                activeLabel={t('admin.support.voiceDraftStop', {}, 'Stop voice')}
                                                className="h-11"
                                            />
                                        </div>
                                    </div>
                                </form>
                            ) : (
                                <div className="support-chat-composer p-4 text-center text-sm font-medium text-slate-400">
                                    {t('admin.support.closedTicketBody', {}, 'This ticket is closed. Reopen it to send a new message.')}
                                </div>
                            )}
                        </>
                    ) : null}
                </div>
            </div>
            </div>
        </AdminPremiumShell>
    );
}

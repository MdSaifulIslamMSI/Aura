export const TICKET_LIST_POLL_MS = 25000;
export const ACTIVE_TICKET_POLL_MS = 15000;
export const SUPPORT_MESSAGE_MAX_LENGTH = 2000;
export const STICKY_SCROLL_THRESHOLD_PX = 64;

export const normalizeLiveCallMode = (value) => (
    String(value || '').trim().toLowerCase() === 'voice' ? 'voice' : 'video'
);

export const getLiveCallModeLabel = (value, t) => (normalizeLiveCallMode(value) === 'voice'
    ? t('profile.support.call.voiceLabel', {}, 'voice call')
    : t('profile.support.call.videoLabel', {}, 'video call'));

export const getLiveCallModeTitle = (value, t) => (normalizeLiveCallMode(value) === 'voice'
    ? t('profile.support.call.voiceTitle', {}, 'Voice Call')
    : t('profile.support.call.videoTitle', {}, 'Video Call'));

export const buildCategoryOptions = (t) => [
    {
        value: 'moderation_appeal',
        label: t('profile.support.category.moderation.label', {}, 'Moderation appeal'),
        description: t('profile.support.category.moderation.desc', {}, 'Warnings, suspensions, account governance, and appeal handling.'),
        accent: 'text-rose-300',
    },
    {
        value: 'order_issue',
        label: t('profile.support.category.order.label', {}, 'Order issue'),
        description: t('profile.support.category.order.desc', {}, 'Payment, cancellation, refund, delivery, or post-order disputes.'),
        accent: 'text-amber-200',
    },
    {
        value: 'general_support',
        label: t('profile.support.category.general.label', {}, 'General support'),
        description: t('profile.support.category.general.desc', {}, 'Profile, listing, account, or product questions that need human help.'),
        accent: 'text-cyan-200',
    },
    {
        value: 'other',
        label: t('profile.support.category.other.label', {}, 'Other'),
        description: t('profile.support.category.other.desc', {}, 'Anything else that needs manual review and a durable response trail.'),
        accent: 'text-slate-200',
    },
];

export const createInitialForm = (prefill = {}, categoryMap = new Map()) => {
    const category = categoryMap.has(prefill?.category)
        ? prefill.category
        : (prefill?.intent === 'appeal' || prefill?.relatedActionId ? 'moderation_appeal' : 'general_support');

    return {
        category,
        subject: String(prefill?.subject || '').trim(),
        message: '',
    };
};

export const sortTickets = (tickets = []) => (
    [...tickets].sort((left, right) => {
        const leftTime = new Date(left?.lastMessageAt || left?.updatedAt || left?.createdAt || 0).getTime();
        const rightTime = new Date(right?.lastMessageAt || right?.updatedAt || right?.createdAt || 0).getTime();
        return rightTime - leftTime;
    })
);

export const normalizeTicket = (ticket) => {
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
        liveCallRequestedMode: normalizeLiveCallMode(ticket.liveCallRequestedMode),
        liveCallLastMediaMode: normalizeLiveCallMode(ticket.liveCallLastMediaMode),
    };
};

export const upsertTicket = (tickets, ticket) => {
    const normalized = normalizeTicket(ticket);
    if (!normalized?._id) return tickets;

    return sortTickets([
        normalized,
        ...tickets.filter((entry) => String(entry._id) !== String(normalized._id)),
    ]);
};

export const appendUniqueMessage = (messages, incoming) => {
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

export const buildMessagesSignature = (messages = []) => messages.map((message) => (
    `${message?._id || message?.sentAt || message?.createdAt || ''}:${message?.text || ''}`
)).join('|');

export const isNearBottom = (element) => {
    if (!element) return true;
    return (element.scrollHeight - element.scrollTop - element.clientHeight) <= STICKY_SCROLL_THRESHOLD_PX;
};

export const getPriorityBadge = (priority) => {
    switch (priority) {
        case 'urgent':
            return 'border-rose-400/25 bg-rose-500/12 text-rose-100';
        case 'high':
            return 'border-amber-300/20 bg-amber-500/12 text-amber-100';
        default:
            return 'border-cyan-300/20 bg-cyan-500/12 text-cyan-100';
    }
};

export const formatSupportPriority = (priority, t) => {
    const normalized = String(priority || 'normal').toLowerCase();
    switch (normalized) {
        case 'urgent':
            return t('profile.support.priority.urgent', {}, 'Urgent');
        case 'high':
            return t('profile.support.priority.high', {}, 'High');
        case 'medium':
            return t('profile.support.priority.medium', {}, 'Medium');
        case 'low':
            return t('profile.support.priority.low', {}, 'Low');
        case 'normal':
            return t('profile.support.priority.normal', {}, 'Normal');
        default:
            return String(priority || 'normal');
    }
};

export const isPrefillMeaningful = (prefill = {}) => Boolean(
    prefill?.category
    || prefill?.relatedActionId
    || prefill?.subject
    || prefill?.intent
);

export const isValidDateValue = (value) => {
    const date = new Date(value || 0);
    return !Number.isNaN(date.getTime());
};

export const getDayKey = (value) => {
    if (!isValidDateValue(value)) return '';
    const date = new Date(value);
    return [date.getFullYear(), date.getMonth(), date.getDate()].join('-');
};

export const getInitials = (value = '') => {
    const parts = String(value || '')
        .trim()
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 2);

    if (parts.length === 0) return 'AU';
    return parts.map((part) => part[0]?.toUpperCase() || '').join('');
};

export const formatThreadPreviewTime = (value, t) => {
    if (!isValidDateValue(value)) return t('profile.support.time.now', {}, 'Now');

    const date = new Date(value);
    const now = new Date();
    const sameDay = date.toDateString() === now.toDateString();
    const diffDays = Math.floor((now.setHours(0, 0, 0, 0) - new Date(date).setHours(0, 0, 0, 0)) / 86400000);

    if (sameDay) {
        return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }

    if (diffDays === 1) {
        return t('profile.support.time.yesterday', {}, 'Yesterday');
    }

    if (diffDays > 1 && diffDays < 7) {
        return date.toLocaleDateString([], { weekday: 'short' });
    }

    return date.toLocaleDateString([], { day: 'numeric', month: 'short' });
};

export const formatMessageDayLabel = (value, t) => {
    if (!isValidDateValue(value)) return t('profile.support.day.today', {}, 'Today');

    const date = new Date(value);
    const today = new Date();
    const yesterday = new Date();
    yesterday.setDate(today.getDate() - 1);

    if (date.toDateString() === today.toDateString()) {
        return t('profile.support.day.today', {}, 'Today');
    }

    if (date.toDateString() === yesterday.toDateString()) {
        return t('profile.support.day.yesterday', {}, 'Yesterday');
    }

    const includeYear = date.getFullYear() !== today.getFullYear();
    return date.toLocaleDateString([], {
        day: 'numeric',
        month: 'short',
        ...(includeYear ? { year: 'numeric' } : {}),
    });
};

export const formatMessageTime = (value) => {
    if (!isValidDateValue(value)) return '';
    return new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
};

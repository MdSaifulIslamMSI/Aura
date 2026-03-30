const STALE_TICKET_MS = 20 * 60 * 1000;

export const normalizeSupportLiveCallMode = (value) => (
    String(value || '').trim().toLowerCase() === 'voice' ? 'voice' : 'video'
);

export const createEmptySupportSummary = () => ({
    totalTickets: 0,
    openTickets: 0,
    resolvedTickets: 0,
    closedTickets: 0,
    waitingOnAdmin: 0,
    waitingOnUser: 0,
    unreadBacklog: 0,
    urgentTickets: 0,
    highPriorityTickets: 0,
    queuedLiveCalls: 0,
    ringingLiveCalls: 0,
    connectedLiveCalls: 0,
    voiceLiveCalls: 0,
    videoLiveCalls: 0,
    staleOpenTickets: 0,
    moderationTickets: 0,
    orderTickets: 0,
    generalTickets: 0,
});

const hasActiveLiveCallState = (ticket = {}) => {
    const status = String(ticket?.liveCallLastStatus || '').trim().toLowerCase();
    return ticket?.liveCallRequested || ['ringing', 'connected'].includes(status);
};

export const buildSupportSummaryFromTickets = (tickets = [], nowValue = Date.now()) => {
    const summary = createEmptySupportSummary();
    const now = Number(nowValue || Date.now());

    (Array.isArray(tickets) ? tickets : []).forEach((ticket) => {
        if (!ticket?._id && !ticket?.subject && !ticket?.status) {
            return;
        }

        summary.totalTickets += 1;

        const status = String(ticket.status || 'open').trim().toLowerCase();
        const priority = String(ticket.priority || 'normal').trim().toLowerCase();
        const unreadByAdmin = Number(ticket.unreadByAdmin || 0);
        const lastMessageAt = new Date(ticket.lastMessageAt || ticket.updatedAt || ticket.createdAt || 0).getTime();

        if (status === 'resolved') {
            summary.resolvedTickets += 1;
        } else if (status === 'closed') {
            summary.closedTickets += 1;
        } else {
            summary.openTickets += 1;
        }

        if (priority === 'urgent') {
            summary.urgentTickets += 1;
        } else if (priority === 'high') {
            summary.highPriorityTickets += 1;
        }

        if (String(ticket.category || '') === 'moderation_appeal') {
            summary.moderationTickets += 1;
        } else if (String(ticket.category || '') === 'order_issue') {
            summary.orderTickets += 1;
        } else {
            summary.generalTickets += 1;
        }

        if (status === 'open' && unreadByAdmin > 0) {
            summary.waitingOnAdmin += 1;
            summary.unreadBacklog += unreadByAdmin;
        }

        if (status === 'open' && ticket.userActionRequired) {
            summary.waitingOnUser += 1;
        }

        if (status === 'open' && Number.isFinite(lastMessageAt) && lastMessageAt > 0 && (now - lastMessageAt) >= STALE_TICKET_MS) {
            summary.staleOpenTickets += 1;
        }

        if (ticket.liveCallRequested) {
            summary.queuedLiveCalls += 1;
        }

        const liveCallStatus = String(ticket.liveCallLastStatus || '').trim().toLowerCase();
        if (liveCallStatus === 'ringing') {
            summary.ringingLiveCalls += 1;
        }
        if (liveCallStatus === 'connected') {
            summary.connectedLiveCalls += 1;
        }

        if (hasActiveLiveCallState(ticket)) {
            const mode = normalizeSupportLiveCallMode(
                ticket.liveCallRequested
                    ? (ticket.liveCallRequestedMode || ticket.liveCallLastMediaMode)
                    : ticket.liveCallLastMediaMode
            );

            if (mode === 'voice') {
                summary.voiceLiveCalls += 1;
            } else {
                summary.videoLiveCalls += 1;
            }
        }
    });

    return summary;
};

export const normalizeSupportSummary = (summary = {}, fallbackTickets = []) => {
    const base = buildSupportSummaryFromTickets(fallbackTickets);
    if (!summary || typeof summary !== 'object') {
        return base;
    }

    return Object.keys(base).reduce((accumulator, key) => {
        const nextValue = Number(summary[key]);
        accumulator[key] = Number.isFinite(nextValue) ? nextValue : base[key];
        return accumulator;
    }, { ...base });
};

export const buildSupportTimeline = ({
    ticket = null,
    activeCallContext = null,
    callStatus = 'idle',
} = {}) => {
    if (!ticket?._id) {
        return [];
    }

    const requestedMode = normalizeSupportLiveCallMode(ticket.liveCallRequestedMode || ticket.liveCallLastMediaMode);
    const activeMode = normalizeSupportLiveCallMode(
        activeCallContext?.mediaMode
        || ticket.liveCallLastMediaMode
        || ticket.liveCallRequestedMode
    );
    const activeContextMatches = activeCallContext?.channelType === 'support_ticket'
        && String(activeCallContext?.contextId || '') === String(ticket._id || '');
    const isActiveCall = activeContextMatches && ['calling', 'incoming', 'connected'].includes(String(callStatus || '').trim().toLowerCase());
    const liveCallStatus = String(ticket.liveCallLastStatus || '').trim().toLowerCase();
    const liveLabel = String(ticket.liveCallLastContextLabel || '').trim();

    return [
        {
            key: 'chat',
            icon: 'chat',
            label: 'Chat',
            state: ticket.status === 'closed' ? 'complete' : 'active',
            detail: ticket.lastMessagePreview || 'Thread is ready for support coordination.',
        },
        {
            key: 'voice',
            icon: 'voice',
            label: 'Voice',
            state: isActiveCall && activeMode === 'voice'
                ? 'active'
                : requestedMode === 'voice' && ticket.liveCallRequested
                    ? 'queued'
                    : requestedMode === 'voice' && ['ringing', 'connected', 'ended', 'missed', 'declined', 'failed'].includes(liveCallStatus)
                        ? 'complete'
                        : 'pending',
            detail: requestedMode === 'voice'
                ? (liveLabel || 'Voice escalation keeps the same thread context.')
                : 'Move into voice when typing becomes the bottleneck.',
        },
        {
            key: 'video',
            icon: 'video',
            label: 'Video',
            state: isActiveCall && activeMode === 'video'
                ? 'active'
                : requestedMode === 'video' && ticket.liveCallRequested
                    ? 'queued'
                    : requestedMode === 'video' && ['ringing', 'connected', 'ended', 'missed', 'declined', 'failed'].includes(liveCallStatus)
                        ? 'complete'
                        : 'pending',
            detail: requestedMode === 'video'
                ? (liveLabel || 'Video escalation keeps camera, mic, and ticket context aligned.')
                : 'Turn on video when visual confirmation or trust repair matters.',
        },
        {
            key: 'resolution',
            icon: 'resolution',
            label: 'Resolution',
            state: ['resolved', 'closed'].includes(String(ticket.status || '').trim().toLowerCase())
                ? 'complete'
                : ticket.userActionRequired
                    ? 'warning'
                    : 'active',
            detail: ticket.resolutionSummary || (
                ticket.userActionRequired
                    ? 'Waiting on the next customer action.'
                    : 'Resolution notes will land here when the thread is settled.'
            ),
        },
    ];
};
